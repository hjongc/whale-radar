import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: pushMock,
    prefetch: vi.fn()
  }),
  usePathname: () => "/market",
  useSearchParams: () => new URLSearchParams()
}));

import { DashboardShell } from "@/components/layout/dashboard-shell";

describe("dashboard shell integration smoke", () => {
  it("navigates to whale route when tab is clicked", async () => {
    pushMock.mockReset();
    const user = userEvent.setup();
    render(<DashboardShell />);

    await user.click(screen.getByRole("button", { name: "운용사 동향" }));

    expect(pushMock).toHaveBeenCalledWith("/whales");
  });
});
