import { expect, test } from '@playwright/test';
import { lockInWords, playTurn } from './helpers';

const HOST = ['cat', 'banana', 'rocket', 'pizza', 'tiger'];
const GUEST = ['dog', 'apple', 'guitar', 'lemon', 'pencil'];

// Two tabs of one browser, talking over BroadcastChannel (`net=local`): the same room code
// as Supabase would carry.
test('two phones play a game online', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();

  await host.goto('/?net=local');
  await host.getByRole('button', { name: /Two phones/ }).click();
  await host.getByTestId('online-name').fill('Hana');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('lobby-code').textContent())!;
  await expect(host.getByTestId('start-online')).toBeDisabled();

  // The guest opens the shared link.
  await guest.goto(`/?net=local&room=${code}`);
  await expect(guest.getByText(`Join room ${code}`)).toBeVisible();
  await guest.getByTestId('online-name').fill('Gus');
  await guest.getByTestId('join').click();
  await expect(guest.getByText('Waiting for Hana to start')).toBeVisible();
  await expect(host.getByText('Gus')).toBeVisible();
  await host.getByTestId('start-online').click();

  // Both lock in at once on their own phones.
  await Promise.all([lockInWords(host, HOST), lockInWords(guest, GUEST)]);

  for (let round = 0; round < 5; round++) {
    // Hana's turn: Gus watches, and hears her copy once she records it.
    await expect(guest.getByText(/Hana is guessing your word/)).toBeVisible();
    await expect(host.getByTestId('round')).toHaveText(`Round ${round + 1} of 5`);
    await playTurn(host, GUEST[round]!);
    await expect(host.getByTestId('verdict')).toContainText('Correct!');
    await expect(guest.getByTestId('verdict')).toContainText('Correct!');
    await guest.getByTestId('next').click();

    // Gus's turn: wrong, and only Hana (the word's owner) gets "Count it".
    await expect(host.getByText(/Gus is guessing your word/)).toBeVisible();
    await guest.getByTestId('play-reversed').click();
    await playTurn(guest, 'nope');
    await expect(guest.getByTestId('verdict')).toContainText('Nope!');
    await expect(guest.getByTestId('count-it')).toHaveCount(0);
    if (round === 4) {
      await host.getByTestId('count-it').click();
      await expect(guest.getByTestId('verdict')).toContainText('Counted!');
    }
    await host.getByTestId('next').click();
  }

  for (const page of [host, guest]) {
    await expect(page.getByTestId('winner')).toContainText('Hana wins!');
    await expect(page.getByTestId('winner')).toContainText('5–1');
  }
});

test('the guest hears the host’s copy of the word', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  await host.goto('/?net=local');
  await host.getByRole('button', { name: /Two phones/ }).click();
  await host.getByTestId('online-name').fill('Hana');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('lobby-code').textContent())!;
  await guest.goto(`/?net=local&room=${code}`);
  await guest.getByTestId('online-name').fill('Gus');
  await guest.getByTestId('join').click();
  await host.getByTestId('start-online').click();
  await Promise.all([lockInWords(host, HOST), lockInWords(guest, GUEST)]);

  await expect(guest.getByTestId('watch-mimic')).toBeDisabled();
  await host.getByTestId('play-reversed').click();
  await host.getByTestId('record-mimic').click();
  await host.waitForTimeout(700);
  await host.getByTestId('record-mimic').click();
  await expect(guest.getByText('Hana recorded a copy')).toBeVisible();
  await expect(guest.getByTestId('watch-mimic')).toBeEnabled();
});
