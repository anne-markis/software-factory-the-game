// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRegion, SECTION_ATTR } from "./domPatch";

function container(html = ""): HTMLElement {
  document.body.innerHTML = `<div id="host">${html}</div>`;
  return document.getElementById("host")!;
}

describe("createRegion scaffold", () => {
  it("writes the scaffold on first call and reports that it wrote", () => {
    const host = container();
    const region = createRegion(host);
    expect(region.setScaffold(`<div ${SECTION_ATTR}="a"></div>`)).toBe(true);
    expect(host.querySelector(`[${SECTION_ATTR}="a"]`)).not.toBeNull();
  });

  it("leaves the DOM untouched when the scaffold is unchanged", () => {
    const host = container();
    const region = createRegion(host);
    region.setScaffold(`<div ${SECTION_ATTR}="a"><button id="b">x</button></div>`);
    const button = host.querySelector("#b")!;
    expect(region.setScaffold(`<div ${SECTION_ATTR}="a"><button id="b">x</button></div>`)).toBe(false);
    expect(host.querySelector("#b")).toBe(button);
  });

  it("rewrites and re-indexes when the scaffold changes", () => {
    const host = container();
    const region = createRegion(host);
    region.setScaffold(`<div ${SECTION_ATTR}="a"></div>`);
    region.patch("a", "<i>one</i>");
    expect(region.setScaffold(`<div ${SECTION_ATTR}="b"></div>`)).toBe(true);
    expect(region.section("a")).toBeUndefined();
    expect(region.section("b")).not.toBeUndefined();
    // The memo from the old scaffold must not suppress a write into the new
    // element that happens to receive the same html.
    region.patch("b", "<i>one</i>");
    expect(host.querySelector(`[${SECTION_ATTR}="b"]`)!.innerHTML).toBe("<i>one</i>");
  });
});

describe("createRegion patch", () => {
  it("writes html into the keyed section only", () => {
    const host = container(`<div ${SECTION_ATTR}="a"></div><div ${SECTION_ATTR}="b"></div>`);
    const region = createRegion(host);
    region.patch("a", "<span>hello</span>");
    expect(region.section("a")!.innerHTML).toBe("<span>hello</span>");
    expect(region.section("b")!.innerHTML).toBe("");
  });

  it("preserves child node identity when the html is unchanged", () => {
    const host = container(`<div ${SECTION_ATTR}="a"></div>`);
    const region = createRegion(host);
    region.patch("a", `<button id="pause">Pause</button>`);
    const button = host.querySelector("#pause")!;
    for (let i = 0; i < 5; i++) region.patch("a", `<button id="pause">Pause</button>`);
    expect(host.querySelector("#pause")).toBe(button);
  });

  it("replaces children when the html changes", () => {
    const host = container(`<div ${SECTION_ATTR}="a"></div>`);
    const region = createRegion(host);
    region.patch("a", `<button id="pause">Pause</button>`);
    const button = host.querySelector("#pause")!;
    region.patch("a", `<button id="pause">Resume</button>`);
    expect(host.querySelector("#pause")).not.toBe(button);
    expect(host.querySelector("#pause")!.textContent).toBe("Resume");
  });

  it("compares against what it last wrote, not the browser's normalized innerHTML", () => {
    // A browser rewrites html on parse (quoting, attribute order, boolean
    // attributes), so comparing a computed string to element.innerHTML would
    // almost always differ and defeat the memo. Patch twice with the same
    // source string and assert no teardown happened.
    const host = container(`<div ${SECTION_ATTR}="a"></div>`);
    const region = createRegion(host);
    const html = `<button data-buy='x' disabled>Buy</button>`;
    region.patch("a", html);
    const button = host.querySelector("[data-buy]")!;
    expect(button.outerHTML).not.toBe(html); // proves normalization happens
    region.patch("a", html);
    expect(host.querySelector("[data-buy]")).toBe(button);
  });

  it("ignores an unknown key", () => {
    const host = container(`<div ${SECTION_ATTR}="a"></div>`);
    const region = createRegion(host);
    expect(() => region.patch("nope", "<i>x</i>")).not.toThrow();
    expect(host.querySelector("i")).toBeNull();
  });

  it("finds sections nested inside plain wrapper elements", () => {
    const host = container(`<div class="cols"><div class="main"><div ${SECTION_ATTR}="deep"></div></div></div>`);
    const region = createRegion(host);
    region.patch("deep", "<i>x</i>");
    expect(host.querySelector(".main i")).not.toBeNull();
  });

  it("claims only the outermost sections, leaving nested ones to a nested region", () => {
    const host = container(`<div ${SECTION_ATTR}="outer"><div ${SECTION_ATTR}="inner"></div></div>`);
    const region = createRegion(host);
    expect(region.section("outer")).not.toBeUndefined();
    expect(region.section("inner")).toBeUndefined();
  });

  it("supports a nested region over one of its own sections", () => {
    const host = container(`<div ${SECTION_ATTR}="outer"></div>`);
    const outer = createRegion(host);
    const inner = createRegion(outer.section("outer")!);
    inner.setScaffold(`<p><span ${SECTION_ATTR}="count"></span><button id="opt">go</button></p>`);
    inner.patch("count", "3 left");
    const button = host.querySelector("#opt")!;
    inner.patch("count", "2 left");
    expect(host.querySelector("#opt")).toBe(button);
    expect(host.querySelector(`[${SECTION_ATTR}="count"]`)!.textContent).toBe("2 left");
    // The outer region must not have claimed the nested section.
    expect(outer.section("count")).toBeUndefined();
  });
});
