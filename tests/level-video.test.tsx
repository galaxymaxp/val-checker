/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { LevelVideo } from "@/app/dashboard/_components/level-video";

afterEach(cleanup);

describe("LevelVideo", () => {
  it("mounts no video element until the user asks for the preview", () => {
    render(
      <LevelVideo
        src="https://valorant.dyn.riotcdn.net/level-2.mp4"
        title="Level 2 preview"
      />,
    );

    expect(document.querySelector("video")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play preview" }),
    ).toBeInTheDocument();
  });

  it("reveals a manual, non-preloading player on click", async () => {
    const user = userEvent.setup();
    render(
      <LevelVideo
        src="https://valorant.dyn.riotcdn.net/level-2.mp4"
        title="Level 2 preview"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Play preview" }));

    const video = document.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveAttribute(
      "src",
      "https://valorant.dyn.riotcdn.net/level-2.mp4",
    );
    expect(video).toHaveAccessibleName("Level 2 preview");
  });

  it("hides the player again from the toggle", async () => {
    const user = userEvent.setup();
    render(
      <LevelVideo
        src="https://valorant.dyn.riotcdn.net/level-2.mp4"
        title="Level 2 preview"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Play preview" }));
    await user.click(screen.getByRole("button", { name: "Hide preview" }));

    expect(document.querySelector("video")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play preview" }),
    ).toBeInTheDocument();
  });
});
