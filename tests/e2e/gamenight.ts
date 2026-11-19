import { expect, type BrowserContext, type Page } from '@playwright/test';

/** A TV page (desktop size) hosting a room, and `names.length` phone pages joined to it. */
export async function openRoom(
  context: BrowserContext,
  names: string[],
): Promise<{ tv: Page; phones: Page[]; code: string }> {
  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1440, height: 900 });
  await tv.goto('/?net=local');
  await tv.getByTestId('host').click();
  const code = (await tv.getByTestId('room-code').textContent())!.trim();
  const phones: Page[] = [];
  for (const [i, name] of names.entries()) {
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    if (i === 0) {
      // The first player scans the QR code: its link carries the room code.
      const link = await tv.locator('[data-qr]').getAttribute('data-qr');
      await phone.goto(link!);
      await expect(phone.getByTestId('join-code')).toHaveValue(code);
    } else {
      await phone.goto('/?net=local');
      await phone.getByTestId('join-start').click();
      await phone.getByTestId('join-code').fill(code.toLowerCase());
    }
    await phone.getByTestId('join-name').fill(name);
    await phone.getByTestId('join').click();
    await expect(phone.getByTestId('phone-lobby')).toBeVisible();
    phones.push(phone);
  }
  await expect(tv.getByTestId('players').locator('li')).toHaveCount(names.length);
  return { tv, phones, code };
}

/** The TV's room state (the host's own, for checks only). */
export async function hostState<T = Record<string, unknown>>(tv: Page): Promise<T> {
  return tv.evaluate(() => {
    const gn = (window as unknown as { __gn: { host: { room: unknown } } }).__gn;
    return JSON.parse(JSON.stringify(gn.host.room));
  }) as Promise<T>;
}

export async function startGame(
  tv: Page,
  game: string,
  settings: Record<string, string> = {},
): Promise<void> {
  await tv.getByTestId(`card-${game}`).click();
  for (const [key, value] of Object.entries(settings))
    await tv.getByTestId(`setting-${key}`).selectOption(value);
  await tv.getByTestId('start-game').click();
}

/** Skips phases until the results screen shows. */
export async function skipToResults(tv: Page): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await tv.getByTestId('winner').isVisible()) return;
    await tv.getByTestId('skip').click();
  }
  await expect(tv.getByTestId('winner')).toBeVisible();
}
