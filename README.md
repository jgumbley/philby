Philby is a conversational coding assistant that moves through an endless rhythm of observation, thought, and action.
Every cycle is a small wager on the world: the model projects what will happen, reality answers back, and the next thought grows in the space between the two.

THE PARTS THAT MATTER

purpose.txt
A single sentence North Star. Optional but powerful for long-running or multi-person work. When present it orients every decision toward a larger horizon.

task.txt
The concrete foothold of the current session. Short, clear, finishable. A cycle may replace this file many times while the purpose remains steady.

thinking.txt
The model’s stream of consciousness for the last turn, including an explicit PREDICTIONS block followed by DECISION\_JSON.

decision.txt
The one-line JSON object distilled from thinking.txt that tells the shell what tool to run or what question to ask the human.

action.txt
The ground truth result of the decision: tool output, error text, or human answer.

done.txt
Drop this file when you want the loop to stop.

THE LOOP

1. Prompt is built from README.md, then (optionally) purpose.txt, then task.txt.
2. Gemini receives the full conversation history, so it already sees every past prediction and outcome.
3. The model writes thinking.txt, ending with DECISION\_JSON.
4. The parser copies DECISION\_JSON to decision.txt.
5. The shell executes the decision, captures reality in action.txt.
6. Unless done.txt exists and the user declines, make loop starts again.

WHY PREDICTIONS

Writing forecasts first forces the model to commit.
Reading action.txt next turn makes it reconcile.
Truth emerges in this gap; no extra plumbing required.

WHEN TO ADD PURPOSE

Use it when context windows bloat, when teammates hand off work, or when the mission spans days.
Leave it out for quick one-shot fixes.

RUNNING

make new          # clear task.txt
make purpose      # optional helper to create purpose.txt
make loop         # enter the dance

Stop any time by touching done.txt or answering “N” to the authorization prompt.

EXTENDING

Keep Decision JSON stable.
Trim or summarise old thinking/action pairs if token limits bite.
Add metrics or summaries only if they give insight; complexity earns its keep or it goes.

Philby is not a build system pretending to be human.
It is a human conversation borrowing the discipline of Make.
Treat each turn like laying one more stone toward a cathedral you might never finish, yet whose shape becomes clearer with every honest prediction and every honest reckoning.

