import { expect, test, type Page } from '@playwright/test';
import { record } from './helpers';
import { hostState, openRoom, skipToResults, startGame } from './gamenight';

// Game Night runs one TV and several phones as pages of one browser, talking over
// BroadcastChannel (`?net=local`): the same messages Supabase would carry. The TV is a desktop
// page, so these run once, in the desktop project.
// eslint-disable-next-line no-empty-pattern -- Playwright passes fixtures first; none are needed here.
test.beforeEach(({}, info) =>
  test.skip(info.project.name !== 'desktop', 'TV + phones run in the desktop project'),
);

/** Waits until exactly `count` of the phones show an enabled button among `testIds`. */
async function phonesReady(phones: Page[], testIds: string[], count: number): Promise<void> {
  await expect
    .poll(async () => {
      let ready = 0;
      for (const phone of phones) {
        for (const id of testIds) {
          const b = phone.getByTestId(id);
          if ((await b.count()) && (await b.isEnabled())) {
            ready++;
            break;
          }
        }
      }
      return ready;
    })
    .toBe(count);
}

/** Clicks the first enabled button among `testIds` on this phone, if there is one. */
async function clickFirstEnabled(phone: Page, testIds: string[]): Promise<boolean> {
  for (const id of testIds) {
    const button = phone.getByTestId(id);
    if ((await button.count()) && (await button.isEnabled())) {
      await button.click();
      return true;
    }
  }
  return false;
}

test('a Game Night: Quip Battle start to finish, then Bluff It without rejoining', async ({ context }) => {
  const { tv, phones } = await openRoom(context, ['Ann', 'Bo', 'Cy']);

  await startGame(tv, 'quip', { rounds: '1', answerSecs: '120' });
  await expect(phones[0]!.getByText('Round 1 of 1')).toBeVisible();
  await tv.getByTestId('skip').click(); // past the intro

  // Everyone writes two answers. Prompts are private: they're on the phones, not the TV.
  const prompts = new Set<string>();
  for (const [i, phone] of phones.entries()) {
    for (let k = 0; k < 2; k++) {
      const prompt = (await phone.getByTestId('prompt').textContent())!;
      prompts.add(prompt);
      await phone.getByTestId('answer-input').fill(`${['Ann', 'Bo', 'Cy'][i]} answer ${k}`);
      await phone.getByTestId('answer-submit').click();
      if (k === 0) await expect(phone.getByTestId('prompt')).not.toHaveText(prompt);
    }
    if (i < 2) await expect(phone.getByTestId('answered')).toBeVisible();
  }
  expect(prompts.size).toBe(3);

  // Three matchups: the one player not in each votes; authors can't.
  for (let m = 0; m < 3; m++) {
    await expect(tv.getByTestId('answer-card')).toHaveCount(2);
    await phonesReady(phones, ['vote-0', 'vote-1'], 1);
    let voted = 0;
    for (const phone of phones) if (await clickFirstEnabled(phone, ['vote-0', 'vote-1'])) voted++;
    expect(voted).toBe(1);
    await expect(tv.getByText(/%/).first()).toBeVisible(); // the result, with vote shares
    await tv.getByTestId('skip').click();
  }
  await expect(tv.getByTestId('scores')).toBeVisible();
  await tv.getByTestId('skip').click();

  // The final round: one prompt for all, up to three votes each, never for your own answer.
  await expect(tv.getByText('Final round').first()).toBeVisible();
  await tv.getByTestId('skip').click();
  for (const [i, phone] of phones.entries()) {
    await phone.getByTestId('answer-input').fill(`final ${i}`);
    await phone.getByTestId('answer-submit').click();
  }
  await expect(tv.getByTestId('answer-card')).toHaveCount(3);
  for (const phone of phones) {
    await expect(phone.getByTestId('vote-submit')).toBeVisible();
    const own = phone.getByRole('button', { name: /yours/ });
    await expect(own).toBeDisabled();
    await clickFirstEnabled(phone, ['vote-0', 'vote-1', 'vote-2']);
    await phone.getByTestId('vote-submit').click();
  }
  await skipToResults(tv);
  await expect(tv.getByTestId('standings').locator('li')).toHaveCount(3);

  // Scores on screen are the TV's own tally.
  const room = await hostState<{ result: { standings: { score: number }[] } }>(tv);
  const total = room.result.standings.reduce((n, r) => n + r.score, 0);
  expect(total).toBeGreaterThan(0);
  for (const phone of phones) await expect(phone.getByTestId('phone-result')).toBeVisible();

  // Back to Game Night: same players, no rejoining, straight into Bluff It.
  await tv.getByTestId('to-lobby').click();
  for (const phone of phones) await expect(phone.getByTestId('phone-lobby')).toBeVisible();
  await startGame(tv, 'bluff', { questions: '4' });
  const state = await hostState<{ game: { state: { questions: { answer: string }[] } } }>(tv);
  const answer = state.game.state.questions[0]!.answer;

  // The real answer is nowhere on the phones or the TV yet (checked when it's distinctive).
  await expect(phones[0]!.getByTestId('lie-input')).toBeVisible();
  if (answer.length >= 5)
    for (const page of [tv, ...phones]) await expect(page.locator('body')).not.toContainText(answer);

  // Typing the truth is turned away; a lie is locked in, once.
  await phones[0]!.getByTestId('lie-input').fill(answer.toUpperCase());
  await phones[0]!.getByTestId('lie-submit').click();
  await expect(phones[0]!.getByTestId('rejected')).toBeVisible();
  await phones[0]!.getByTestId('lie-input').fill('zzz a fib');
  await phones[0]!.getByTestId('lie-submit').click();
  await expect(phones[0]!.getByTestId('lied')).toContainText('zzz a fib');
  await phones[1]!.getByTestId('lie-input').fill('ZZZ A FIB!'); // the same lie: merged
  await phones[1]!.getByTestId('lie-submit').click();
  await phones[2]!.getByTestId('lie-input').fill('another fib');
  await phones[2]!.getByTestId('lie-submit').click();

  // Picking: your own lie is off limits.
  await expect(tv.getByTestId('option')).toHaveCount(3);
  await phonesReady(phones, ['pick-0', 'pick-1', 'pick-2'], 3);
  const own = phones[0]!.getByRole('button', { name: /your lie/ });
  await expect(own).toBeDisabled();
  for (const phone of phones) await clickFirstEnabled(phone, ['pick-0', 'pick-1', 'pick-2']);
  await expect(tv.getByText('THE TRUTH')).toBeVisible();
  await expect(tv.locator('body')).toContainText(answer);

  await skipToResults(tv);
  await tv.getByTestId('play-again').click();
  await expect(phones[0]!.getByTestId('lie-input')).toBeVisible();
});

test('Sketch It: draw, caption, vote', async ({ context }) => {
  const { tv, phones } = await openRoom(context, ['Ann', 'Bo', 'Cy']);
  await startGame(tv, 'sketch');
  for (const phone of phones) {
    await expect(phone.getByTestId('draw-submit')).toBeDisabled();
    const box = (await phone.getByTestId('pad').boundingBox())!;
    await phone.mouse.move(box.x + 30, box.y + 30);
    await phone.mouse.down();
    for (let t = 1; t <= 20; t++) await phone.mouse.move(box.x + 30 + t * 12, box.y + 30 + t * 8);
    await phone.mouse.up();
    await phone.getByTestId('undo').click();
    await expect(phone.getByTestId('draw-submit')).toBeDisabled();
    await phone.mouse.move(box.x + 50, box.y + 50);
    await phone.mouse.down();
    for (let t = 1; t <= 20; t++) await phone.mouse.move(box.x + 50 + t * 10, box.y + 50 + (t % 4) * 10);
    await phone.mouse.up();
    await phone.getByTestId('draw-submit').click();
  }
  // Each drawing in turn: the artist sits out, the others caption and vote.
  for (let d = 0; d < 3; d++) {
    await expect(tv.getByTestId('drawing')).toBeVisible();
    await phonesReady(phones, ['caption-input'], 2);
    let captions = 0;
    for (const [i, phone] of phones.entries()) {
      const input = phone.getByTestId('caption-input');
      if (await input.isVisible()) {
        await input.fill(`fake title ${d}-${i}`);
        await phone.getByTestId('caption-submit').click();
        captions++;
      }
    }
    expect(captions).toBe(2);
    await expect(tv.getByTestId('option')).toHaveCount(3);
    await phonesReady(phones, ['vote-0', 'vote-1', 'vote-2'], 2);
    for (const phone of phones) await clickFirstEnabled(phone, ['vote-0', 'vote-1', 'vote-2']);
    await expect(tv.getByText('THE REAL TITLE')).toBeVisible();
    await tv.getByTestId('skip').click();
  }
  await skipToResults(tv);
});

test('Reverse with three players: everyone decodes someone else’s word', async ({ context }) => {
  const { tv, phones } = await openRoom(context, ['Ann', 'Bo', 'Cy']);
  await startGame(tv, 'reverse', { words: '2' });
  for (const [n, phone] of phones.entries()) {
    await expect(phone.getByTestId('lock-in')).toBeDisabled();
    for (let i = 0; i < 2; i++) {
      await phone.getByTestId(`word-${i}`).fill(`word${n}${i}`);
      await record(phone, `record-${i}`);
    }
    await phone.getByTestId('lock-in').click();
  }
  for (let round = 0; round < 2; round++) {
    for (const phone of phones) {
      await expect(phone.getByTestId('play-reversed')).toBeEnabled(); // the word's clip arrived
      await record(phone, 'record-mimic');
    }
    // Ann guesses right (the TV knows her word); the others miss.
    const state = await hostState<{
      game: { state: { attempts: { guesser: string; word: number }[]; words: { text: string }[] } };
      players: { id: string; name: string }[];
    }>(tv);
    const annId = state.players.find((p) => p.name === 'Ann')!.id;
    const annWord =
      state.game.state.words[state.game.state.attempts.find((a) => a.guesser === annId)!.word]!.text;
    for (const [i, phone] of phones.entries()) {
      await phone.getByTestId('guess-input').fill(i === 0 ? annWord.toUpperCase() : 'nope');
      await phone.getByTestId('guess').click();
    }
    await expect(tv.getByTestId('attempt')).toHaveCount(3);
    await expect(tv.getByText('Correct!')).toHaveCount(1);
    // An owner counts a near miss.
    await phonesReady(phones, ['count-it'], 2);
    const counted = await Promise.all(phones.map((p) => p.getByTestId('count-it').count()));
    const owner = phones[counted.findIndex((c) => c > 0)]!;
    await owner.getByTestId('count-it').first().click();
    await expect(tv.getByText('Counted!')).toHaveCount(1);
    await tv.getByTestId('skip').click();
  }
  await expect(tv.getByTestId('winner')).toBeVisible();
});

test('reconnecting, pausing and removing players', async ({ context }) => {
  const { tv, phones } = await openRoom(context, ['Ann', 'Bo', 'Cy']);
  await startGame(tv, 'bluff', { questions: '4' });
  await phones[1]!.getByTestId('lie-input').fill('my clever lie');
  await phones[1]!.getByTestId('lie-submit').click();
  await expect(phones[1]!.getByTestId('lied')).toBeVisible();

  // A refresh keeps the player and their submitted answer.
  await phones[1]!.reload();
  await expect(phones[1]!.getByTestId('lied')).toContainText('my clever lie');
  await expect(tv.getByTestId('players')).toHaveCount(0); // still in the game, not the lobby
  const room = await hostState<{ players: unknown[] }>(tv);
  expect(room.players).toHaveLength(3);

  // Pause stops the clock.
  await tv.getByTestId('pause').click();
  await expect(tv.getByTestId('paused')).toBeVisible();
  const before = await tv.getByTestId('timer').textContent();
  await tv.waitForTimeout(1500);
  expect(await tv.getByTestId('timer').textContent()).toBe(before);
  await tv.getByTestId('resume').click();

  // Back in the lobby the host removes a player; they can't come back.
  tv.on('dialog', (d) => void d.accept());
  await tv.getByTestId('end-game').click();
  await expect(tv.getByTestId('players').locator('li')).toHaveCount(3);
  await tv.getByRole('button', { name: 'Remove Cy' }).click();
  await expect(phones[2]!.getByTestId('kicked')).toBeVisible();
  await expect(tv.getByTestId('players').locator('li')).toHaveCount(2);
  await phones[2]!.reload();
  await expect(phones[2]!.getByTestId('kicked')).toBeVisible();
});

test('the TV picks up its room after a reload', async ({ context }) => {
  const { tv, phones } = await openRoom(context, ['Ann', 'Bo']);
  await startGame(tv, 'bluff', { questions: '4' });
  await tv.reload();
  await expect(tv.getByTestId('skip')).toBeVisible();
  await expect(phones[0]!.getByTestId('lie-input')).toBeVisible();
  await phones[0]!.getByTestId('lie-input').fill('still here');
  await phones[0]!.getByTestId('lie-submit').click();
  await expect(phones[0]!.getByTestId('lied')).toBeVisible();
});

test('playing with bots: one phone and two bots finish Quip Battle', async ({ context }) => {
  const { tv, phones } = await openRoom(context, ['Ann']);
  await tv.getByTestId('add-bot').click();
  await tv.getByTestId('add-bot').click();
  await expect(tv.getByTestId('players').getByText('🤖 bot')).toHaveCount(2);
  await startGame(tv, 'quip', { rounds: '1', final: 'no' });
  await tv.getByTestId('skip').click(); // past the intro
  const phone = phones[0]!;
  for (let k = 0; k < 2; k++) {
    await phone.getByTestId('answer-input').fill(`human answer ${k}`);
    await phone.getByTestId('answer-submit').click();
  }
  // The bots answer by themselves, so voting starts without skipping.
  await expect(tv.getByTestId('answer-card').first()).toBeVisible({ timeout: 20_000 });
  // And they vote: every matchup gets a result, then the game ends on its own timers or skips.
  await expect(tv.getByText(/%/).first()).toBeVisible({ timeout: 20_000 });
  await skipToResults(tv);
  await expect(tv.getByTestId('standings').locator('li')).toHaveCount(3);
});
