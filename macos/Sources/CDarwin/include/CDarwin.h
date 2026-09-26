// A thin, flat C layer over the Darwin APIs MoonTask reads the machine with
// (libproc, sysctl, Mach host statistics, the routing socket and IOKit).
//
// Everything is returned in plain structs of fixed-size fields, so the Swift
// side never touches the kernel's unions and variable-length records.

#ifndef MOONTASK_CDARWIN_H
#define MOONTASK_CDARWIN_H

#include <stdint.h>
#include <sys/types.h>

// ---------------------------------------------------------------- processes

/// One process as the BSD layer lists it (readable for every process).
typedef struct {
    int32_t pid;
    int32_t ppid;
    uint32_t uid;
    /// SIDL 1, SRUN 2, SSLEEP 3, SSTOP 4, SZOMB 5
    int32_t state;
    int32_t nice;
    int64_t start_sec;
    int64_t start_usec;
    char comm[33];
} mt_kinfo;

/// All processes. Returns how many were written (at most `max`), or -1.
int mt_list_processes(mt_kinfo *out, int max);

/// Resource usage of one process. `ok` is 0 when the process is gone or
/// not readable.
typedef struct {
    int ok;
    /// Nanoseconds of CPU time, user + system.
    uint64_t cpu_ns;
    /// The memory Activity Monitor calls "Memory" (physical footprint).
    uint64_t footprint;
    uint64_t resident;
    uint64_t disk_read;
    uint64_t disk_written;
    /// Only for processes of the current user (or as root); -1 otherwise.
    int32_t threads;
    int64_t virtual_size;
} mt_usage;

void mt_process_usage(int32_t pid, mt_usage *out);

/// The executable's path; returns its length, or 0.
int mt_process_path(int32_t pid, char *out, int size);

/// The raw KERN_PROCARGS2 block (argc, exec path, argv, envp). Returns the
/// number of bytes written, or -1 (other users' processes need root).
int mt_process_args(int32_t pid, char *out, int size);

/// Paths of the process' open files, each NUL-terminated, one after
/// another. Returns the number of bytes written, or -1.
int mt_open_files(int32_t pid, char *out, int size);

/// An open socket of a process.
typedef struct {
    int32_t fd;
    /// 4 or 6
    int32_t family;
    /// 1 = TCP, 2 = UDP
    int32_t protocol;
    char local_address[46];
    int32_t local_port;
    char remote_address[46];
    int32_t remote_port;
    /// TCPS_* for TCP (0 closed … 10 time-wait), -1 for UDP
    int32_t tcp_state;
} mt_socket;

/// The process' TCP and UDP sockets. Returns how many, or -1.
int mt_sockets(int32_t pid, mt_socket *out, int max);

// ---------------------------------------------------------------- machine

/// CPU ticks per core: user, system, idle, nice — 4 values per core.
/// Returns the number of cores, or -1.
int mt_cpu_ticks(uint64_t *out, int max_cores);

typedef struct {
    uint64_t total;
    uint64_t free;
    /// What Activity Monitor calls "App Memory".
    uint64_t app;
    uint64_t wired;
    uint64_t compressed;
    /// File cache and purgeable memory, which macOS gives back on demand.
    uint64_t cached;
    uint64_t swap_total;
    uint64_t swap_used;
} mt_memory;

int mt_memory_stats(mt_memory *out);

/// Bytes received and sent on all interfaces but loopback, since boot.
int mt_network_totals(uint64_t *received, uint64_t *sent);

/// Bytes read from and written to all block storage devices, since boot.
int mt_disk_totals(uint64_t *read, uint64_t *written);

typedef struct {
    char name[128];
    /// 0–100, or -1 when the driver doesn't say.
    double utilization;
    /// Bytes, or -1.
    int64_t memory_used;
    /// GPU cores (Apple silicon), or -1.
    int32_t cores;
} mt_gpu;

/// The machine's GPUs (IOAccelerator). Returns how many, or -1.
int mt_gpus(mt_gpu *out, int max);

/// A sysctl string such as "machdep.cpu.brand_string"; returns its length.
int mt_sysctl_string(const char *name, char *out, int size);
/// A sysctl integer such as "hw.memsize"; returns -1 when unknown.
int64_t mt_sysctl_int(const char *name);

#endif
