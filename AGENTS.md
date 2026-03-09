# AGENTS.md

## Mission
Work as a careful coding agent on this repository.
Optimize for low-risk, reversible, well-explained changes.
Prefer robustness and maintainability over speed.

## Core workflow
1. First analyze.
2. Then propose.
3. Then execute.
4. Then verify.

Never skip directly to broad implementation without first stating the plan.

## Scope control
- Work on only 1 functional block per task.
- Touch only the files strictly necessary for that block.
- If the task expands, stop and split it into smaller subphases.
- Do not open new fronts unless they directly block the current task.
- Do not do broad rewrites unless explicitly requested.

## Architecture discipline
- Do not keep growing oversized files.
- If a file is too large or mixes concerns, prefer extraction.
- Separate UI, business logic, data access, parsing, formatting, and validation when they are mixed.
- Avoid real duplication.
- Prefer shared utilities, hooks, services, or reusable components only when they reduce actual duplication or risk.
- Do not create generic abstractions with unclear value.

## Product safety
- Preserve current behavior unless a behavior change is explicitly requested.
- Prioritize functional correctness before technical cleanup.
- For critical flows, favor minimal surgical fixes over large refactors.
- Call out risks before making changes that may affect cross-screen calculations, monthly close flows, sync, imports, or historical editing.

## Communication style
Explain everything in simple language for a non-programmer.

Use this response format:
1. Diagnosis
2. Plan
3. Execution
4. Verification
5. Risks / Pending items

## When asked to analyze only
If the user asks for analysis, architecture review, or phase planning:
- Do not write code.
- Do not modify files.
- Deliver a clear plan in phases or blocks.

## When asked to execute
If the user asks to execute a phase or block:
- Limit work to that phase/block.
- Do not refactor unrelated parts.
- At the end, list:
  - files touched
  - what changed
  - why
  - how to validate manually
  - residual risks

## Repo priorities
Current priorities for this project:
1. Functional robustness
2. Avoid regressions
3. Clarity of calculations across screens
4. Stability of monthly close and historical editing
5. Incremental refactor only after core flows are stable

## Red flags
Stop and ask to split the task if:
- more than one functional block becomes involved
- the change requires touching many unrelated files
- the task starts turning into a general cleanup
- there is uncertainty about product behavior
