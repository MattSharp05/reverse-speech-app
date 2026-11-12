import { expect, test } from '@playwright/test';
import { lockInWords, playTurn } from './helpers';

const ANA = ['cat', 'banana', 'rocket', 'pizza', 'tiger'];
const BEN = ['dog', 'apple', 'guitar', 'lemon', 'pencil'];

test('two players finish a game on one phone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /One phone/ }).click();
  await page.getByTestId('name-1').fill('Ana');
  await page.getByTestId('name-2').fill('Ben');
  await page.getByTestId('start').click();

  // Ana locks in while Ben covers his ears, then they swap.
  await expect(page.getByText('Pass the phone to Ana')).toBeVisible();
  await expect(page.getByText(/Ben.*no peeking/)).toBeVisible();
  await page.getByTestId('ready').click();
  await expect(page.getByTestId('lock-in')).toBeDisabled();
  await lockInWords(page, ANA);
  await expect(page.getByText('Pass the phone to Ben')).toBeVisible();
  await page.getByTestId('ready').click();
  await lockInWords(page, BEN);

  for (let round = 0; round < 5; round++) {
    await expect(page.getByTestId('round')).toHaveText(`Round ${round + 1} of 5`);
    // Ana guesses Ben's word, always right (in capitals: case doesn't matter).
    await expect(page.getByText(/Ana, guess Ben’s word/)).toBeVisible();
    await playTurn(page, BEN[round]!.toUpperCase());
    await expect(page.getByTestId('verdict')).toContainText('Correct!');
    await expect(page.getByTestId('answer')).toHaveText(BEN[round]!);
    await page.getByTestId('next').click();

    // Ben guesses Ana's word: a plural in round 1 (Ana counts it), wrong after that.
    await expect(page.getByText(/Ben, guess Ana’s word/)).toBeVisible();
    await playTurn(page, round === 0 ? 'cats' : 'zzz');
    if (round === 0) {
      await expect(page.getByTestId('verdict')).toContainText('So close!');
      await page.getByTestId('count-it').click();
      await expect(page.getByTestId('verdict')).toContainText('Counted!');
    } else {
      await expect(page.getByTestId('verdict')).toContainText('Nope!');
    }
    await page.getByTestId('next').click();
  }

  await expect(page.getByTestId('winner')).toContainText('Ana wins!');
  await expect(page.getByTestId('winner')).toContainText('5–1');

  await page.getByTestId('rematch').click();
  await expect(page.getByText('Pass the phone to Ana')).toBeVisible();
});
