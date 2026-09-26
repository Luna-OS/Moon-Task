#include "CDarwin.h"

#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <arpa/inet.h>
#include <errno.h>
#include <libproc.h>
#include <mach/mach.h>
#include <mach/mach_host.h>
#include <mach/mach_time.h>
#include <net/if.h>
#include <net/route.h>
#include <netinet/in.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/sysctl.h>

// ---------------------------------------------------------------- helpers

static void copy_string(char *out, size_t size, const char *in) {
    if (size == 0) return;
    strncpy(out, in, size - 1);
    out[size - 1] = '\0';
}

/// Mach absolute time units to nanoseconds (1:1 on Intel, 125:3 on Apple
/// silicon).
static uint64_t ticks_to_ns(uint64_t ticks) {
    static mach_timebase_info_data_t timebase;
    if (timebase.denom == 0) mach_timebase_info(&timebase);
    return (uint64_t)((__uint128_t)ticks * timebase.numer / timebase.denom);
}

// ---------------------------------------------------------------- processes

int mt_list_processes(mt_kinfo *out, int max) {
    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0};
    size_t size = 0;
    if (sysctl(mib, 4, NULL, &size, NULL, 0) != 0) return -1;
    // Processes may start between the two calls.
    size += size / 8 + 16 * sizeof(struct kinfo_proc);
    struct kinfo_proc *procs = malloc(size);
    if (procs == NULL) return -1;
    if (sysctl(mib, 4, procs, &size, NULL, 0) != 0) {
        free(procs);
        return -1;
    }
    int count = (int)(size / sizeof(struct kinfo_proc));
    int written = 0;
    for (int i = 0; i < count && written < max; i++) {
        struct kinfo_proc *kp = &procs[i];
        mt_kinfo *k = &out[written++];
        memset(k, 0, sizeof *k);
        k->pid = kp->kp_proc.p_pid;
        k->ppid = kp->kp_eproc.e_ppid;
        k->uid = kp->kp_eproc.e_ucred.cr_uid;
        k->state = kp->kp_proc.p_stat;
        k->nice = kp->kp_proc.p_nice;
        k->start_sec = kp->kp_proc.p_starttime.tv_sec;
        k->start_usec = kp->kp_proc.p_starttime.tv_usec;
        // proc_name gives up to 32 characters, p_comm only 16.
        char name[2 * MAXCOMLEN + 1] = {0};
        if (proc_name(k->pid, name, sizeof name) > 0) {
            copy_string(k->comm, sizeof k->comm, name);
        } else {
            copy_string(k->comm, sizeof k->comm, kp->kp_proc.p_comm);
        }
    }
    free(procs);
    return written;
}

void mt_process_usage(int32_t pid, mt_usage *out) {
    memset(out, 0, sizeof *out);
    out->threads = -1;
    out->virtual_size = -1;
    // proc_pid_rusage works for every process, not only the user's own.
    struct rusage_info_v4 ri;
    if (proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&ri) == 0) {
        out->ok = 1;
        out->cpu_ns = ticks_to_ns(ri.ri_user_time + ri.ri_system_time);
        out->footprint = ri.ri_phys_footprint;
        out->resident = ri.ri_resident_size;
        out->disk_read = ri.ri_diskio_bytesread;
        out->disk_written = ri.ri_diskio_byteswritten;
    }
    // Task info needs the same user (or root).
    struct proc_taskinfo ti;
    if (proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &ti, sizeof ti) == (int)sizeof ti) {
        out->threads = ti.pti_threadnum;
        out->virtual_size = (int64_t)ti.pti_virtual_size;
    }
}

int mt_process_path(int32_t pid, char *out, int size) {
    if (size <= 0) return 0;
    out[0] = '\0';
    int len = proc_pidpath(pid, out, (uint32_t)size);
    return len > 0 ? len : 0;
}

int mt_process_args(int32_t pid, char *out, int size) {
    int mib[3] = {CTL_KERN, KERN_PROCARGS2, pid};
    size_t len = (size_t)size;
    if (sysctl(mib, 3, out, &len, NULL, 0) != 0) return -1;
    return (int)len;
}

static struct proc_fdinfo *list_fds(int32_t pid, int *count) {
    int size = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, NULL, 0);
    if (size <= 0) return NULL;
    size += 32 * (int)sizeof(struct proc_fdinfo);
    struct proc_fdinfo *fds = malloc((size_t)size);
    if (fds == NULL) return NULL;
    size = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, fds, size);
    if (size <= 0) {
        free(fds);
        return NULL;
    }
    *count = size / (int)sizeof(struct proc_fdinfo);
    return fds;
}

int mt_open_files(int32_t pid, char *out, int size) {
    int count = 0;
    struct proc_fdinfo *fds = list_fds(pid, &count);
    if (fds == NULL) return -1;
    int written = 0;
    for (int i = 0; i < count; i++) {
        if (fds[i].proc_fdtype != PROX_FDTYPE_VNODE) continue;
        struct vnode_fdinfowithpath vi;
        int n = proc_pidfdinfo(pid, fds[i].proc_fd, PROC_PIDFDVNODEPATHINFO, &vi,
                               PROC_PIDFDVNODEPATHINFO_SIZE);
        if (n != PROC_PIDFDVNODEPATHINFO_SIZE || vi.pvip.vip_path[0] == '\0') continue;
        int len = (int)strnlen(vi.pvip.vip_path, sizeof vi.pvip.vip_path);
        if (written + len + 1 > size) break;
        memcpy(out + written, vi.pvip.vip_path, (size_t)len);
        out[written + len] = '\0';
        written += len + 1;
    }
    free(fds);
    return written;
}

static void format_address(const struct in_sockinfo *in, int is_local, char *out,
                           size_t size) {
    if (in->insi_vflag & INI_IPV4) {
        const struct in_addr *a = is_local ? &in->insi_laddr.ina_46.i46a_addr4
                                           : &in->insi_faddr.ina_46.i46a_addr4;
        inet_ntop(AF_INET, a, out, (socklen_t)size);
    } else {
        const struct in6_addr *a = is_local ? &in->insi_laddr.ina_6 : &in->insi_faddr.ina_6;
        inet_ntop(AF_INET6, a, out, (socklen_t)size);
    }
}

int mt_sockets(int32_t pid, mt_socket *out, int max) {
    int count = 0;
    struct proc_fdinfo *fds = list_fds(pid, &count);
    if (fds == NULL) return -1;
    int written = 0;
    for (int i = 0; i < count && written < max; i++) {
        if (fds[i].proc_fdtype != PROX_FDTYPE_SOCKET) continue;
        struct socket_fdinfo si;
        int n = proc_pidfdinfo(pid, fds[i].proc_fd, PROC_PIDFDSOCKETINFO, &si,
                               PROC_PIDFDSOCKETINFO_SIZE);
        if (n != PROC_PIDFDSOCKETINFO_SIZE) continue;
        int family = si.psi.soi_family;
        if (family != AF_INET && family != AF_INET6) continue;

        const struct in_sockinfo *in;
        int protocol;
        int state = -1;
        if (si.psi.soi_kind == SOCKINFO_TCP) {
            in = &si.psi.soi_proto.pri_tcp.tcpsi_ini;
            protocol = 1;
            state = si.psi.soi_proto.pri_tcp.tcpsi_state;
        } else if (si.psi.soi_kind == SOCKINFO_IN && si.psi.soi_protocol == IPPROTO_UDP) {
            in = &si.psi.soi_proto.pri_in;
            protocol = 2;
        } else {
            continue;
        }

        mt_socket *s = &out[written++];
        memset(s, 0, sizeof *s);
        s->fd = fds[i].proc_fd;
        s->family = (in->insi_vflag & INI_IPV4) ? 4 : 6;
        s->protocol = protocol;
        s->tcp_state = state;
        format_address(in, 1, s->local_address, sizeof s->local_address);
        format_address(in, 0, s->remote_address, sizeof s->remote_address);
        s->local_port = ntohs((uint16_t)in->insi_lport);
        s->remote_port = ntohs((uint16_t)in->insi_fport);
    }
    free(fds);
    return written;
}

// ---------------------------------------------------------------- machine

int mt_cpu_ticks(uint64_t *out, int max_cores) {
    natural_t cores = 0;
    processor_info_array_t info = NULL;
    mach_msg_type_number_t info_count = 0;
    kern_return_t kr = host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &cores,
                                           &info, &info_count);
    if (kr != KERN_SUCCESS) return -1;
    processor_cpu_load_info_t loads = (processor_cpu_load_info_t)info;
    int n = (int)cores < max_cores ? (int)cores : max_cores;
    for (int i = 0; i < n; i++) {
        out[4 * i + 0] = loads[i].cpu_ticks[CPU_STATE_USER];
        out[4 * i + 1] = loads[i].cpu_ticks[CPU_STATE_SYSTEM];
        out[4 * i + 2] = loads[i].cpu_ticks[CPU_STATE_IDLE];
        out[4 * i + 3] = loads[i].cpu_ticks[CPU_STATE_NICE];
    }
    vm_deallocate(mach_task_self(), (vm_address_t)info,
                  (vm_size_t)info_count * sizeof(integer_t));
    return n;
}

int mt_memory_stats(mt_memory *out) {
    memset(out, 0, sizeof *out);
    uint64_t total = 0;
    size_t len = sizeof total;
    if (sysctlbyname("hw.memsize", &total, &len, NULL, 0) != 0) return -1;
    out->total = total;

    vm_statistics64_data_t vm;
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    if (host_statistics64(mach_host_self(), HOST_VM_INFO64, (host_info64_t)&vm, &count) !=
        KERN_SUCCESS)
        return -1;
    vm_size_t page = 0;
    host_page_size(mach_host_self(), &page);
    uint64_t p = (uint64_t)page;
    uint64_t internal = (uint64_t)vm.internal_page_count;
    uint64_t purgeable = (uint64_t)vm.purgeable_count;
    out->app = (internal > purgeable ? internal - purgeable : 0) * p;
    out->wired = (uint64_t)vm.wire_count * p;
    out->compressed = (uint64_t)vm.compressor_page_count * p;
    out->cached = ((uint64_t)vm.external_page_count + purgeable) * p;
    out->free = (uint64_t)vm.free_count * p;

    struct xsw_usage swap;
    len = sizeof swap;
    if (sysctlbyname("vm.swapusage", &swap, &len, NULL, 0) == 0) {
        out->swap_total = swap.xsu_total;
        out->swap_used = swap.xsu_used;
    }
    return 0;
}

int mt_network_totals(uint64_t *received, uint64_t *sent) {
    *received = 0;
    *sent = 0;
    int mib[6] = {CTL_NET, PF_ROUTE, 0, 0, NET_RT_IFLIST2, 0};
    size_t size = 0;
    if (sysctl(mib, 6, NULL, &size, NULL, 0) != 0) return -1;
    char *buf = malloc(size);
    if (buf == NULL) return -1;
    if (sysctl(mib, 6, buf, &size, NULL, 0) != 0) {
        free(buf);
        return -1;
    }
    for (char *next = buf; next < buf + size;) {
        struct if_msghdr *ifm = (struct if_msghdr *)next;
        if (ifm->ifm_msglen == 0) break;
        next += ifm->ifm_msglen;
        if (ifm->ifm_type != RTM_IFINFO2) continue;
        struct if_msghdr2 *if2 = (struct if_msghdr2 *)ifm;
        if (if2->ifm_flags & IFF_LOOPBACK) continue;
        *received += if2->ifm_data.ifi_ibytes;
        *sent += if2->ifm_data.ifi_obytes;
    }
    free(buf);
    return 0;
}

static int64_t dict_int(CFDictionaryRef dict, const char *key) {
    CFStringRef k = CFStringCreateWithCString(kCFAllocatorDefault, key, kCFStringEncodingUTF8);
    CFTypeRef value = CFDictionaryGetValue(dict, k);
    CFRelease(k);
    int64_t result = -1;
    if (value != NULL && CFGetTypeID(value) == CFNumberGetTypeID()) {
        CFNumberGetValue((CFNumberRef)value, kCFNumberSInt64Type, &result);
    }
    return result;
}

int mt_disk_totals(uint64_t *read, uint64_t *written) {
    *read = 0;
    *written = 0;
    io_iterator_t it;
    if (IOServiceGetMatchingServices(MACH_PORT_NULL, IOServiceMatching("IOBlockStorageDriver"),
                                     &it) != KERN_SUCCESS)
        return -1;
    io_registry_entry_t entry;
    while ((entry = IOIteratorNext(it)) != 0) {
        CFTypeRef stats = IORegistryEntryCreateCFProperty(entry, CFSTR("Statistics"),
                                                          kCFAllocatorDefault, 0);
        if (stats != NULL) {
            if (CFGetTypeID(stats) == CFDictionaryGetTypeID()) {
                int64_t r = dict_int((CFDictionaryRef)stats, "Bytes (Read)");
                int64_t w = dict_int((CFDictionaryRef)stats, "Bytes (Write)");
                if (r > 0) *read += (uint64_t)r;
                if (w > 0) *written += (uint64_t)w;
            }
            CFRelease(stats);
        }
        IOObjectRelease(entry);
    }
    IOObjectRelease(it);
    return 0;
}

static void registry_string(io_registry_entry_t entry, const char *key, char *out, size_t size) {
    CFStringRef k = CFStringCreateWithCString(kCFAllocatorDefault, key, kCFStringEncodingUTF8);
    CFTypeRef value = IORegistryEntrySearchCFProperty(
        entry, kIOServicePlane, k, kCFAllocatorDefault,
        kIORegistryIterateRecursively | kIORegistryIterateParents);
    CFRelease(k);
    if (value == NULL) return;
    if (CFGetTypeID(value) == CFStringGetTypeID()) {
        CFStringGetCString((CFStringRef)value, out, (CFIndex)size, kCFStringEncodingUTF8);
    } else if (CFGetTypeID(value) == CFDataGetTypeID()) {
        // Intel Macs keep the model name as a NUL-terminated byte string.
        CFIndex len = CFDataGetLength((CFDataRef)value);
        if (len > (CFIndex)size - 1) len = (CFIndex)size - 1;
        memcpy(out, CFDataGetBytePtr((CFDataRef)value), (size_t)len);
        out[len] = '\0';
    }
    CFRelease(value);
}

int mt_gpus(mt_gpu *out, int max) {
    io_iterator_t it;
    if (IOServiceGetMatchingServices(MACH_PORT_NULL, IOServiceMatching("IOAccelerator"), &it) !=
        KERN_SUCCESS)
        return -1;
    int written = 0;
    io_registry_entry_t entry;
    while ((entry = IOIteratorNext(it)) != 0) {
        if (written < max) {
            mt_gpu *g = &out[written++];
            memset(g, 0, sizeof *g);
            g->utilization = -1;
            g->memory_used = -1;
            g->cores = -1;
            registry_string(entry, "model", g->name, sizeof g->name);

            CFTypeRef perf = IORegistryEntryCreateCFProperty(
                entry, CFSTR("PerformanceStatistics"), kCFAllocatorDefault, 0);
            if (perf != NULL) {
                if (CFGetTypeID(perf) == CFDictionaryGetTypeID()) {
                    CFDictionaryRef d = (CFDictionaryRef)perf;
                    int64_t util = dict_int(d, "Device Utilization %");
                    if (util < 0) util = dict_int(d, "GPU Activity(%)");
                    if (util >= 0) g->utilization = (double)(util > 100 ? 100 : util);
                    int64_t used = dict_int(d, "In use system memory");
                    if (used < 0) used = dict_int(d, "vramUsedBytes");
                    g->memory_used = used;
                }
                CFRelease(perf);
            }
            CFTypeRef cores = IORegistryEntryCreateCFProperty(entry, CFSTR("gpu-core-count"),
                                                              kCFAllocatorDefault, 0);
            if (cores != NULL) {
                if (CFGetTypeID(cores) == CFNumberGetTypeID()) {
                    int32_t n = -1;
                    CFNumberGetValue((CFNumberRef)cores, kCFNumberSInt32Type, &n);
                    g->cores = n;
                }
                CFRelease(cores);
            }
        }
        IOObjectRelease(entry);
    }
    IOObjectRelease(it);
    return written;
}

int mt_sysctl_string(const char *name, char *out, int size) {
    if (size <= 0) return 0;
    size_t len = (size_t)size;
    if (sysctlbyname(name, out, &len, NULL, 0) != 0) {
        out[0] = '\0';
        return 0;
    }
    out[size - 1] = '\0';
    return (int)strlen(out);
}

int64_t mt_sysctl_int(const char *name) {
    int64_t value = 0;
    size_t len = sizeof value;
    if (sysctlbyname(name, &value, &len, NULL, 0) != 0) return -1;
    if (len == sizeof(int32_t)) {
        int32_t small;
        memcpy(&small, &value, sizeof small);
        return small;
    }
    return value;
}
