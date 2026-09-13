import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const base = process.env.UI_URL || "http://localhost:3000";
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("button", {name:"Use light theme"}).waitFor();
  const nav = tab => page.getByRole("navigation", {name:"Main navigation"}).getByRole("button", {name:tab, exact:true});
  const audit = [];
  async function inspect(name) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow, name).toBe(false);
    const effects = await page.evaluate(() => [...document.querySelectorAll("*")].filter(element => {
      const style = getComputedStyle(element);
      return style.boxShadow !== "none" || style.filter !== "none" || style.backdropFilter !== "none" || style.backgroundImage.includes("gradient");
    }).slice(0, 5).map(element => `${element.tagName}.${element.className}`));
    expect(effects, name + " decorative effects").toEqual([]);
    await page.screenshot({path: "/tmp/precision-" + name + ".png", fullPage:true});
    audit.push(name);
  }
  async function modal(name, trigger) {
    await trigger.click();
    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible();
    const size = await dialog.evaluate(el => {
      const r=el.getBoundingClientRect();
      return {inside:r.top >= 0 && r.bottom <= innerHeight + 1, fit:el.scrollWidth <= el.clientWidth + 1};
    });
    expect(size.inside, name + " viewport").toBe(true);
    expect(size.fit, name + " width").toBe(true);
    await inspect(name);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  async function go(tab) {
    await nav(tab).click();
    await expect(nav(tab)).toHaveClass(/active/);
    await page.waitForTimeout(120);
  }
  for (const theme of ["dark","light"]) {
    if(theme === "light") await page.getByRole("button",{name:"Use light theme"}).click();
    for (const width of [1440,390,720]) {
      await page.setViewportSize({width,height:width === 720 ? 450 : 900});
      for(const tab of ["Explore","Launch","Trade","Portfolio","Swap","Bridge","Privacy"]) {
        await go(tab);
        await inspect(theme + "-" + tab + "-" + width);
      }
      await go("Launch");
      await modal(theme+"-launch-modal-"+width, page.getByRole("button",{name:"Launch graduating token",exact:true}));
      await go("Trade");
      await modal(theme+"-order-modal-"+width, page.getByRole("button",{name:"Place order",exact:true}));
      await go("Swap");
      for(const route of ["v2","coins","stablecoins","mainnet"]) {
        await page.getByLabel("Swap route",{exact:true}).selectOption(route);
        await page.waitForTimeout(200);
        await inspect(theme+"-swap-"+route+"-"+width);
      }
      await page.getByLabel("Swap route",{exact:true}).selectOption("v2");
      await modal(theme+"-picker-"+width,page.getByRole("combobox",{name:"V2 coin",exact:true}));
      await go("Privacy");
      await expect(page.getByRole("heading", {name:"Preview only", exact:true})).toBeVisible();
      expect(await page.getByRole("dialog").count()).toBe(0);
    }
  }
  expect(errors).toEqual([]);
  console.log(JSON.stringify({screens:audit.length,errors,result:"PASS",audit}));
} finally { await browser.close(); }
