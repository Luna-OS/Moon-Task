import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { SYSTEM_INFO, snapshot } from "@/test/fixtures";
import type { ProcessDetails } from "@/types/models";

const mockedInvoke = vi.mocked(invoke);

function details(pid: number): ProcessDetails {
  return {
    pid,
    name: "vim",
    exe: "/usr/bin/vim",
    command: ["vim", "notes.md"],
    cwd: "/home/luna",
    environment: [{ key: "HOME", value: "/home/luna" }],
    parent: { pid: 200, name: "bash" },
    user: "luna",
    owner: "current",
    status: "sleeping",
    startTime: 1_700_000_300,
    runTime: 60,
    cpuTime: 1500,
    memory: 1024 * 1024,
    virtualMemory: 4 * 1024 * 1024,
    priority: "normal",
    nice: 0,
    openFiles: 4,
    totalDiskRead: 0,
    totalDiskWritten: 0,
    threads: [{ tid: pid, name: "vim", state: "Sleeping", cpuTime: 1500, priority: 0 }],
    modules: [],
    handles: [],
    protected: false,
  };
}

let calls: { cmd: string; args: unknown }[] = [];

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
  mockedInvoke.mockImplementation((cmd: string, args?: unknown) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "system_info":
        return Promise.resolve(SYSTEM_INFO);
      case "snapshot":
        return Promise.resolve(snapshot());
      case "process_details":
        return Promise.resolve(details((args as { pid: number }).pid));
      case "process_action":
        return Promise.resolve({ affected: 1, failures: [] });
      case "connections_list":
        return Promise.resolve([]);
      case "services_list":
        return Promise.resolve([]);
      default:
        return Promise.reject(new Error(`unexpected command ${cmd}`));
    }
  });
});

async function openProcesses() {
  render(<App />);
  await screen.findByText("moonbase");
  fireEvent.click(screen.getByRole("button", { name: /Processes/ }));
  return screen.findByRole("treegrid", { name: "Process list" });
}

describe("App", () => {
  it("shows the overview with live numbers", async () => {
    render(<App />);
    expect(await screen.findByText("moonbase")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "CPU: 23.5 %" })).toBeInTheDocument();
    expect(screen.getByText("Busiest right now")).toBeInTheDocument();
    expect(screen.getAllByText("firefox").length).toBeGreaterThan(0);
  });

  it("lists processes as a tree and filters them by search", async () => {
    const table = await openProcesses();
    expect(within(table).getByText("vim")).toBeInTheDocument();
    // Kernel threads are hidden by default.
    expect(within(table).queryByText("kworker/0:1")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search processes" }), {
      target: { value: "vim" },
    });
    await waitFor(() => expect(within(table).queryByText("firefox")).not.toBeInTheDocument());
    expect(within(table).getByText("vim")).toBeInTheDocument();
    // The ancestors stay as context.
    expect(within(table).getByText("bash")).toBeInTheDocument();
  });

  it("shows details of the selected process and ends it after confirmation", async () => {
    const table = await openProcesses();
    fireEvent.click(within(table).getByText("vim"));

    const panel = await screen.findByRole("complementary", { name: "Details of vim" });
    expect(await within(panel).findByText("/usr/bin/vim")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /End$/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Process: vim \(PID 300\)/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "End process" }));

    await screen.findByText("Asked vim to quit.");
    const action = calls.find((c) => c.cmd === "process_action");
    expect(action?.args).toEqual({
      request: { pid: 300, startTime: 1_700_000_300, action: { type: "terminate" } },
      confirmed: true,
    });
  });

  it("protects processes the backend marks as protected", async () => {
    const table = await openProcesses();
    fireEvent.click(within(table).getByText("systemd"));
    const panel = await screen.findByRole("complementary", { name: "Details of systemd" });
    expect(within(panel).getByRole("button", { name: /End$/ })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: /Suspend/ })).toBeDisabled();
  });

  it("groups processes by app", async () => {
    const table = await openProcesses();
    fireEvent.click(screen.getByRole("radio", { name: /Apps/ }));
    await waitFor(() => expect(within(table).getAllByText("firefox")).toHaveLength(1));
    expect(within(table).getByTitle("Processes in this app")).toHaveTextContent("3");
  });

  it("switches sections with Ctrl+number", async () => {
    render(<App />);
    await screen.findByText("moonbase");
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    expect(await screen.findByRole("heading", { name: "Performance" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "6", ctrlKey: true });
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("shows the GPU in the overview, the sidebar and the process list", async () => {
    render(<App />);
    await screen.findByText("moonbase");
    expect(screen.getByRole("region", { name: "GPU: 37.0 %" })).toBeInTheDocument();
    expect(screen.getByText(/NVIDIA GeForce RTX 4070 · 58 °C/)).toBeInTheDocument();
    // Like Task Manager's sidebar: load and temperature.
    expect(screen.getByText("37 % · 58 °C")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Processes/ }));
    const table = await screen.findByRole("treegrid", { name: "Process list" });
    expect(within(table).getByRole("button", { name: "GPU" })).toBeInTheDocument();
  });

  it("hides the GPU column where the platform can't attribute GPU load", async () => {
    const noGpu = snapshot({
      gpus: [],
      processes: snapshot().processes.map((p) => ({ ...p, gpu: null })),
    });
    mockedInvoke.mockImplementation((cmd: string) =>
      cmd === "system_info"
        ? Promise.resolve(SYSTEM_INFO)
        : cmd === "snapshot"
          ? Promise.resolve(noGpu)
          : Promise.resolve([]),
    );
    render(<App />);
    await screen.findByText("moonbase");
    expect(screen.queryByRole("region", { name: /^GPU/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Processes/ }));
    const table = await screen.findByRole("treegrid", { name: "Process list" });
    expect(within(table).queryByRole("button", { name: "GPU" })).not.toBeInTheDocument();
  });

  it("reports a backend failure instead of going blank", async () => {
    mockedInvoke.mockImplementation((cmd: string) =>
      cmd === "system_info"
        ? Promise.resolve(SYSTEM_INFO)
        : Promise.reject(new Error("permission denied")),
    );
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  });
});
