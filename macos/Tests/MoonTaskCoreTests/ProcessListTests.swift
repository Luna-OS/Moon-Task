import XCTest
@testable import MoonTaskCore

private func row(
    _ pid: Int32, parent: Int32?, _ name: String, cpu: Double = 0, memory: UInt64 = 0,
    owner: Owner = .current, user: String = "luna"
) -> ProcessRow {
    ProcessRow(
        pid: pid, parentPid: parent, name: name, user: user, uid: 501, owner: owner,
        state: .sleeping, cpu: cpu, memory: memory, threads: 4
    )
}

private let sample: [ProcessRow] = [
    row(0, parent: nil, "kernel_task", cpu: 3, owner: .kernel, user: "root"),
    row(1, parent: 0, "launchd", owner: .system, user: "root"),
    row(300, parent: 1, "WindowServer", cpu: 8, memory: 400, owner: .system, user: "_windowserver"),
    row(500, parent: 1, "Safari", cpu: 5, memory: 900),
    row(501, parent: 500, "Safari Web Content", cpu: 12, memory: 300),
    row(502, parent: 500, "Safari Web Content", cpu: 1, memory: 200),
    row(600, parent: 1, "Terminal", cpu: 0.5, memory: 100),
    row(601, parent: 600, "zsh", memory: 10),
]

final class ProcessListTests: XCTestCase {
    func testTreeNestsChildrenUnderParentsSortedByCPU() {
        let rows = visibleRows(sample, VisibleOptions(mode: .tree))
        XCTAssertEqual(rows.map(\.process.pid), [0, 1, 300, 500, 501, 502, 600, 601])
        XCTAssertEqual(rows.map(\.depth), [0, 1, 2, 2, 3, 3, 2, 3])
        XCTAssertTrue(rows[1].hasChildren)
    }

    func testCollapsedBranchesHideTheirChildren() {
        let rows = visibleRows(sample, VisibleOptions(mode: .tree, collapsed: [500]))
        XCTAssertFalse(rows.contains { $0.process.pid == 501 })
        XCTAssertEqual(rows.first { $0.process.pid == 500 }?.isExpanded, false)
    }

    func testSearchKeepsAncestorsDimmed() {
        let rows = visibleRows(sample, VisibleOptions(mode: .tree, query: "zsh"))
        XCTAssertEqual(rows.map(\.process.pid), [0, 1, 600, 601])
        XCTAssertEqual(rows.map(\.isDimmed), [true, true, true, false])
    }

    func testListIsFlatAndSorted() {
        let opts = VisibleOptions(mode: .list, sort: SortState(key: .memory, ascending: false))
        let rows = visibleRows(sample, opts)
        XCTAssertEqual(rows.first?.process.name, "Safari")
        XCTAssertTrue(rows.allSatisfy { $0.depth == 0 })
    }

    func testAppsGroupSameNamedProcessesAndSumThem() {
        let opts = VisibleOptions(mode: .apps, sort: SortState(key: .cpu, ascending: false))
        let rows = visibleRows(sample, opts)
        let group = rows.first { $0.kind == .group }
        XCTAssertEqual(group?.process.name, "Safari Web Content")
        XCTAssertEqual(group?.process.cpu, 13)
        XCTAssertEqual(group?.process.memory, 500)
        XCTAssertEqual(group?.members.count, 2)
        XCTAssertEqual(rows.first?.id, group?.id, "the busiest app comes first")
    }

    func testOpenGroupsListTheirMembers() {
        let opts = VisibleOptions(mode: .apps, openGroups: [groupRowID("Safari Web Content")])
        let rows = visibleRows(sample, opts)
        XCTAssertEqual(rows.filter { $0.depth == 1 }.count, 2)
    }

    func testOwnerFilterAndHiddenKernel() {
        let mine = visibleRows(sample, VisibleOptions(mode: .list, owner: .mine))
        XCTAssertTrue(mine.allSatisfy { $0.process.owner == .current })
        let noKernel = visibleRows(sample, VisibleOptions(mode: .list, showKernel: false))
        XCTAssertFalse(noKernel.contains { $0.process.owner == .kernel })
    }

    func testParentCyclesStillShowEveryProcess() {
        let cyclic = [row(10, parent: 11, "a"), row(11, parent: 10, "b")]
        let rows = visibleRows(cyclic, VisibleOptions(mode: .tree))
        XCTAssertEqual(Set(rows.map(\.process.pid)), [10, 11])
    }

    func testDescendants() {
        XCTAssertEqual(countDescendants(sample, of: 500), 2)
        XCTAssertEqual(descendantsFirst(sample, of: 600).map(\.pid), [601, 600])
    }

    func testSortToggle() {
        let cpu = SortState(key: .cpu, ascending: false)
        XCTAssertEqual(cpu.toggled(.cpu), SortState(key: .cpu, ascending: true))
        XCTAssertEqual(cpu.toggled(.name), SortState(key: .name, ascending: true))
        XCTAssertEqual(cpu.toggled(.memory), SortState(key: .memory, ascending: false))
    }
}

final class SafetyTests: XCTestCase {
    func testProtectedProcesses() {
        XCTAssertTrue(Safety.isProtected(pid: 0, name: "kernel_task", ownPid: 999))
        XCTAssertTrue(Safety.isProtected(pid: 1, name: "launchd", ownPid: 999))
        XCTAssertTrue(Safety.isProtected(pid: 300, name: "WindowServer", ownPid: 999))
        XCTAssertTrue(Safety.isProtected(pid: 999, name: "MoonTask", ownPid: 999))
        XCTAssertFalse(Safety.isProtected(pid: 500, name: "Safari", ownPid: 999))
    }

    func testConfirmation() {
        let own = sample[3]
        let system = sample[2]
        XCTAssertFalse(Safety.needsConfirmation(.end, on: own, confirmOwn: false))
        XCTAssertTrue(Safety.needsConfirmation(.end, on: own, confirmOwn: true))
        XCTAssertTrue(Safety.needsConfirmation(.end, on: system, confirmOwn: false))
        XCTAssertTrue(Safety.needsConfirmation(.endTree, on: own, confirmOwn: false))
        XCTAssertFalse(Safety.needsConfirmation(.resume, on: system, confirmOwn: true))
    }

    func testProtectedRowsAllowNothing() {
        var p = sample[3]
        p.isProtected = true
        XCTAssertFalse(Safety.isAllowed(.end, on: p))
        XCTAssertFalse(Safety.isAllowed(.suspend, on: p))
    }
}

final class FormatTests: XCTestCase {
    func testBytes() {
        XCTAssertEqual(Format.bytes(UInt64(512)), "512 B")
        XCTAssertEqual(Format.bytes(UInt64(1536)), "1.5 KB")
        XCTAssertEqual(Format.bytes(UInt64(3) * 1024 * 1024 * 1024), "3.0 GB")
        XCTAssertEqual(Format.bytes(UInt64(200) * 1024 * 1024), "200 MB")
    }

    func testOthers() {
        XCTAssertEqual(Format.rate(0), "0 B/s")
        XCTAssertEqual(Format.percent(37), "37.0 %")
        XCTAssertEqual(Format.percent(37, digits: 0), "37 %")
        XCTAssertEqual(Format.duration(3 * 86_400 + 4 * 3_600), "3 d 4 h")
        XCTAssertEqual(Format.duration(125), "2 min")
        XCTAssertEqual(Format.cpuTime(3_725), "1:02:05")
        XCTAssertEqual(Format.temperature(58.4), "58 °C")
    }
}

final class HistoryTests: XCTestCase {
    func testSeriesKeepsCapacity() {
        var s = Series(capacity: 3)
        for v in 1...5 { s.append(Double(v)) }
        XCTAssertEqual(s.values, [3, 4, 5])
        XCTAssertEqual(s.peak, 5)
    }

    func testActivity() {
        let now = Date()
        let old = [sample[3], sample[4]]
        let new = [sample[3], sample[6]]
        let events = activity(from: old, to: new, at: now)
        XCTAssertEqual(events.count, 2)
        XCTAssertTrue(events.contains { $0.kind == .started && $0.pid == 600 })
        XCTAssertTrue(events.contains { $0.kind == .ended && $0.pid == 501 })
    }
}
