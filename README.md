# zeta-trainer

A practice tool for [Zetamac](https://arithmetic.zetamac.com/). It plays the same game, but it records how long every problem takes you. It then shows you which kinds of problems slow you down and gives you a mode that drills those.

## Getting it running

You only need a web browser. There's nothing to install and no build step.

1. Get the code, either with git:
   ```bash
   git clone https://github.com/lucasarnaiz06-afk/zeta-trainer.git
   ```
   or with **Code → Download ZIP** on GitHub, then unzip it.
2. Open `index.html` in Chrome, Safari, Firefox or Edge. Double-clicking it works.

If you'd rather serve it, run `python3 -m http.server` in the folder and go to http://localhost:8000.

## Playing

Press **Start** or hit Enter. Type the answer; it moves on as soon as the answer is right, just like Zetamac. Esc quits a game without saving it.

There are three modes:

- **Classic** uses Zetamac's default game: addition with 2–100, subtraction as the reverse of addition, multiplication with 2–12 × 2–100, division as the reverse of multiplication, and 120 seconds. Only these games count toward your official score history.
- **Focus** gives you more of the problem types you're slow at, based on your past games. It needs a few classic games first before it has anything to go on.
- **Drill** practises one problem type, such as × 7 or subtraction with borrowing. Start a drill by clicking a row on the Analysis page.

## What it tracks

Answers are grouped into problem types:

- **Addition**: carry vs no carry, and under vs over 100.
- **Subtraction**: the same split, with borrowing.
- **Multiplication**: one type per factor, ×2 through ×12.
- **Division**: one type per divisor, ÷2 through ÷12.

- **Analysis** ranks these types slowest first. It also has a heatmap of your × and ÷ times and a list of the individual problems you're slowest on.
- **Progress** shows your score over time with a 10-game average, your seconds per problem for each operation, and how much each problem type has improved.

Typical times put more weight on recent answers, so they follow how fast you are now rather than your all-time average. Focus mode picks problem types roughly in proportion to how slow you are at them. 15% of its problems stay random, so the other types keep getting measured.

## Your data

Your history is stored in your browser's local storage and isn't sent anywhere. That means it's tied to one browser on one machine. Also, opening the file directly and opening it through a local server count as separate places with separate histories. To back up your history or move it to another browser, use **Export** and **Import** in Settings.

You can change the game length, ranges and operations in Settings. Games with custom settings are still recorded and analysed, but they don't count as official scores.
