import Darwin
import XCTest
@testable import MoonTaskCore
@testable import MoonTaskSystem

final class SamplerTests: XCTestCase {
    func testSamplesTheMachine() {
        let sampler = Sampler()
        _ = sampler.sample()
        Thread.sleep(forTimeInterval: 0.3)
        let s = sampler.sample()

        XCTAssertGreaterThan(s.memory.total, 0)
        XCTAssertGreaterThan(s.memory.used, 0)
        XCTAssertFalse(s.cpu.perCore.isEmpty)
        XCTAssertTrue((0...100).contains(s.cpu.total))
        XCTAssertGreaterThan(s.processes.count, 10)

        let me = s.processes.first { $0.pid == getpid() }
        XCTAssertNotNil(me, "the test runner lists itself")
        XCTAssertEqual(me?.owner, .current)
        XCTAssertTrue(me?.isProtected ?? false, "MoonTask never ends itself")
        XCTAssertNotNil(me?.threads)
        XCTAssertGreaterThan(me?.memory ?? 0, 0)

        let launchd = s.processes.first { $0.pid == 1 }
        XCTAssertEqual(launchd?.name, "launchd")
        XCTAssertTrue(launchd?.isProtected ?? false)
        XCTAssertGreaterThan(launchd?.memory ?? 0, 0, "other users' processes have their memory (via ps)")

        XCTAssertFalse(s.volumes.isEmpty)
    }

    func testParsesPS() {
        let usage = Sampler.parsePS("""
            1  12345   0:42.50
          412   2048 1-02:03:04.00
            7     10   123:45.67
        """)
        XCTAssertEqual(usage[1]?.resident, 12345 * 1024)
        XCTAssertEqual(usage[1]?.cpuNs, 42_500_000_000)
        XCTAssertEqual(usage[412]?.cpuNs, UInt64((86_400 + 2 * 3600 + 3 * 60 + 4) * 1e9))
        XCTAssertEqual(Sampler.parseCPUTime("123:45.67")!, 7425.67, accuracy: 0.001)
    }

    func testSystemInfo() {
        let info = SystemInfoReader.read()
        XCTAssertGreaterThan(info.cores, 0)
        XCTAssertGreaterThan(info.memory, 0)
        XCTAssertFalse(info.osVersion.isEmpty)
    }
}

final class InspectorTests: XCTestCase {
    func testOwnProcessDetails() throws {
        let sampler = Sampler()
        let me = try XCTUnwrap(sampler.sample().processes.first { $0.pid == getpid() })
        let details = ProcessInspector.details(of: me)
        XCTAssertFalse(details.arguments?.isEmpty ?? true)
        XCTAssertNotNil(details.environment)
        XCTAssertNotNil(details.openFiles)
        XCTAssertNotNil(details.connections)
    }

    func testParsesProcArgs() {
        var bytes: [UInt8] = []
        withUnsafeBytes(of: Int32(2)) { bytes.append(contentsOf: $0) }
        bytes += Array("/bin/zsh".utf8) + [0, 0, 0]
        bytes += Array("zsh".utf8) + [0] + Array("-l".utf8) + [0]
        bytes += Array("HOME=/Users/luna".utf8) + [0] + Array("A=b=c".utf8) + [0, 0]
        let (args, env) = ProcessInspector.parseProcArgs(bytes)
        XCTAssertEqual(args, ["zsh", "-l"])
        XCTAssertEqual(env?.map(\.name), ["HOME", "A"])
        XCTAssertEqual(env?.last?.value, "b=c")
    }

    func testTCPStates() {
        XCTAssertEqual(ProcessInspector.tcpState(1), "Listen")
        XCTAssertEqual(ProcessInspector.tcpState(4), "Established")
    }
}

final class ControlTests: XCTestCase {
    func testActsOnlyOnTheSameProcessInstance() throws {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/sleep")
        child.arguments = ["30"]
        try child.run()
        defer { if child.isRunning { child.terminate() } }
        Thread.sleep(forTimeInterval: 0.2)

        let row = try XCTUnwrap(Sampler().sample().processes.first { $0.pid == child.processIdentifier })
        var stale = row
        stale.startTime -= 60
        XCTAssertThrowsError(try ProcessControl.perform(.end, on: stale)) { error in
            XCTAssertEqual(error as? ControlError, .gone("sleep"))
        }
        XCTAssertTrue(child.isRunning)

        try ProcessControl.perform(.suspend, on: row)
        try ProcessControl.perform(.resume, on: row)
        try ProcessControl.perform(.setPriority(10), on: row)
        try ProcessControl.perform(.end, on: row)
        child.waitUntilExit()
        XCTAssertFalse(child.isRunning)
    }

    func testRefusesProtectedProcesses() throws {
        let launchd = try XCTUnwrap(Sampler().sample().processes.first { $0.pid == 1 })
        XCTAssertThrowsError(try ProcessControl.perform(.end, on: launchd))
    }
}

final class LaunchAgentTests: XCTestCase {
    func testParsesLaunchctlList() {
        let jobs = LaunchAgents.parseList("""
        PID\tStatus\tLabel
        412\t0\tcom.apple.Finder
        -\t0\tcom.example.backup
        -\t78\tcom.example.broken
        """)
        XCTAssertEqual(jobs.map(\.label), ["com.apple.Finder", "com.example.backup", "com.example.broken"])
        XCTAssertEqual(jobs[0].pid, 412)
        XCTAssertTrue(jobs[0].isApple)
        XCTAssertNil(jobs[1].pid)
        XCTAssertEqual(jobs[2].lastExitStatus, 78)
    }

    func testListsTheSessionsJobs() {
        XCTAssertFalse(LaunchAgents.list().isEmpty)
    }
}
