import { expect, type Page } from '@playwright/test';

/** Taps a record button, "speaks" for a moment (the fake mic beeps), and waits for the clip. */
export async function record(page: Page, testId: string): Promise<void> {
  const button = page.getByTestId(testId);
  await button.click();
  await expect(button).toHaveClass(/live/);
  await page.waitForTimeout(700);
  await button.click();
  await expect(button).toHaveClass(/done/);
}

export async function lockInWords(page: Page, words: string[]): Promise<void> {
  for (const [i, word] of words.entries()) {
    await page.getByTestId(`word-${i}`).fill(word);
    await record(page, `record-${i}`);
  }
  await page.getByTestId('lock-in').click();
}

/** One turn: hear it backwards, copy it, hear the copy, guess. */
export async function playTurn(page: Page, guess: string): Promise<void> {
  await page.getByTestId('play-reversed').click();
  await record(page, 'record-mimic');
  await expect(page.getByTestId('play-mimic')).toBeEnabled();
  await page.getByTestId('guess-input').fill(guess);
  await page.getByTestId('guess').click();
}
