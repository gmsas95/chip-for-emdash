import { describe, expect, it } from "vitest";
import { AdminPageShell, DataState, formatMinorAmount } from "../../src/admin/shared.js";

describe("Commerce admin formatting", () => {
  it("formats integer minor units with the requested currency", () => {
    expect(formatMinorAmount(12345, "MYR")).toBe("RM 123.45");
  });

  it("renders a safe fallback for invalid amounts", () => {
    expect(formatMinorAmount(-1, "MYR")).toBe("RM 0.00");
  });
});

describe("Commerce admin presentation shell", () => {
  it("provides the shared operator surface class and page heading", () => {
    const element = AdminPageShell({ title: "Products", children: null });
    const props = element.props as { className: string; children: Array<{ props: { children: { props: { children: string } } } }> };
    expect(props.className).toBe("commerce-admin");
    expect(props.children[0].props.children.props.children).toBe("Products");
  });

  it("renders errors as an alert instead of a blank panel", () => {
    const element = DataState({ loading: false, error: "Request failed", children: null });
    const props = element.props as { role: string; children: string };
    expect(props.role).toBe("alert");
    expect(props.children).toBe("Request failed");
  });
});
