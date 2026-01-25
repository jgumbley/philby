# philby

Philby is a tiny, Make-driven harness for running an LLM "agent" against a repo in a controlled, repeatable way.
It includes a stub agent runner that executes an executable spec defined by Make targets.

The repo is intentionally small:
- `AGENTS.md` is the contract: the rules the agent must follow (use `make`, stay in this directory, no hidden fallbacks, etc).
- `Makefile` is the entrypoint: it forwards all user/agent commands into `common.mk`.
- `common.mk` is the implementation: it defines the standard targets used to inspect/update the repo and to run commands that might prompt for secrets.
- `pane.sh` is used by `make agent-*` to run a target in a tmux split pane so a human can type secrets locally while the agent watches output.

## How you use it

1. Run `make digest` to print a canonical “context bundle” of the project files. This is the sanctioned way to understand what’s here.
2. Run everything via `make` targets (don’t invoke scripts/tools directly).
3. When a command might prompt for secrets (sudo/BECOME, etc), use an agent pane: `make agent-<target>`.

## Standard targets

- `make digest`: generates a summary of the important business rules in the codebase.
- `make ingest`: copies the digest to the clipboard via `fixip | wl-copy` (will fail if either command is not available).
- `make update`: refreshes `AGENTS.md` from upstream (`curl` required) and overwrites the local file.
- `make clean`: removes `.venv/`.
- `make spec`: runs the executable spec (defaults to `SPEC_TARGETS`, currently `spec-doc`).
- `make agent`: runs the stub spawner/worker to execute `PHILBY_SPEC_TARGETS` (defaults to `spec`).
- `make test`: validates wiring and prerequisites, then runs the core spec targets.
- `make rocknix`: pulls and runs `ghcr.io/rocknix/rocknix-build:latest` with this repo mounted at `/work` (publishes exposed ports).
- `make tiefighter-media`: copies a legally-owned TIE Fighter ISO into `./tiefighter.iso` for the container to use.
- `make tiefighter`: pulls and runs `jgoerzen/dosbox:latest`, mounts this repo at `/dos/drive_c`, exposes VNC on `localhost:5901` (password `tiefighter`), and lets you IMGMOUNT `tiefighter.iso` inside DOSBox so you can switch to the CD drive.
- `make agent-<target>`: runs `make <target>` inside a tmux split pane (requires `tmux` and being inside an existing tmux session).

## Makefile template

`Makefile.new` is a guided copy/paste template for bootstrapping a new philby-based repo.

## Executable spec

<!-- PHILBY_SPEC_START -->
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Pipeline as Spec: CTO-Level Engineering Insights for AI-Driven Development",
  "version": "1.0.0",
  "thesis": {
    "headline": "Pipeline as spec is the real unlock for AI dev",
    "summary": "Your ceiling on AI-driven development isn't the model—it's the quality, coverage, and speed of your verifier. If CI is weak, AI just helps you ship wrong things faster. If CI is strong, AI turns implementation into a commodity and shifts advantage to whoever encodes intent best."
  },

  "principles": [
    {
      "id": 1,
      "title": "Treat CI as the executable definition of correct",
      "slug": "ci-as-spec",
      "insight": "Your real spec isn't a doc. It's the set of things your delivery system can accept/reject deterministically: tests, types, linters, policy checks, SLO gates, deploy rules.",
      "implication": "If you want AI to produce reliable changes, you don't prompt better. You make correctness machine-checkable.",
      "pitch": "Move the source of truth upward from code to verification. Code becomes the most disposable artifact.",
      "tags": ["verification", "determinism", "source-of-truth"]
    },
    {
      "id": 2,
      "title": "AI coding is a constrained search problem, not a magic coder",
      "slug": "constrained-search",
      "insight": "The useful mental model: the model explores implementation variants; the pipeline prunes the search space.",
      "implication": "Reliability comes from tight constraints + fast feedback, not from smarter prose.",
      "pitch": "Investment in verification gives compounding returns because it enables more autonomous iteration.",
      "tags": ["mental-model", "constraints", "feedback-loops"]
    },
    {
      "id": 3,
      "title": "Determinism is the scaling lever for agents",
      "slug": "determinism-scales",
      "insight": "Human review and AI judging AI are subjective and don't scale. Deterministic gates do scale: CI green becomes the objective contract.",
      "implication": "Agents are only as trustworthy as the environment's ability to say no repeatedly and consistently.",
      "pitch": null,
      "tags": ["scaling", "agents", "trust", "determinism"]
    },
    {
      "id": 4,
      "title": "Speed of verification becomes a first-class platform concern",
      "slug": "verification-throughput",
      "insight": "If you want autonomy, your pipeline can't be slow or flaky.",
      "implication": "The bottleneck shifts from developer throughput to verification throughput.",
      "requirements": [
        "Fast, hermetic, reproducible CI",
        "Parallelization, caching, sharding",
        "Low-flake test discipline",
        "Minimal works-on-my-machine variance"
      ],
      "tags": ["performance", "platform", "bottlenecks"]
    },
    {
      "id": 5,
      "title": "Expand correctness beyond behavior: operational + governance belongs in the spec",
      "slug": "full-spectrum-correctness",
      "insight": "The executable spec should cover functional behavior, static safety, operational budgets, and security/compliance.",
      "implication": "If it's not encoded, it's implicitly allowed to regress—especially under agent pressure.",
      "specDimensions": {
        "functional": {
          "description": "Behavioral correctness",
          "examples": ["unit tests", "integration tests", "contract tests", "property tests"]
        },
        "static": {
          "description": "Static safety constraints",
          "examples": ["types", "lint", "API contracts"]
        },
        "operational": {
          "description": "Runtime budgets and SLOs",
          "examples": ["latency p95/p99", "memory", "cold start", "throughput", "cost"]
        },
        "governance": {
          "description": "Security and compliance",
          "examples": ["SAST/DAST", "dependency policy", "secret scanning", "IaC policy"]
        }
      },
      "tags": ["correctness", "slos", "security", "governance"]
    },
    {
      "id": 6,
      "title": "Your pipeline becomes the product definition (whether you admit it or not)",
      "slug": "pipeline-is-product",
      "insight": "Once generation optimizes for passing gates: whatever isn't measured becomes negotiable; whatever is measured becomes the law.",
      "implication": "You'll get exactly what you instrument for—so shallow or gameable checks yield shallow or gameable systems.",
      "risk": "CTO risk: Goodhart's Law applied to AI-generated code",
      "tags": ["product", "measurement", "goodharts-law"]
    },
    {
      "id": 7,
      "title": "Teaching to the test is the new dominant failure mode",
      "slug": "spec-gaming",
      "insight": "Expect pathologies unless you harden verification.",
      "pathologies": [
        {
          "symptom": "Passes tests, but architecture is wrong or unmaintainable",
          "category": "architectural"
        },
        {
          "symptom": "Benchmarks pass on the measured case, fail in reality",
          "category": "performance"
        },
        {
          "symptom": "Security checks pass, but threat model gaps remain",
          "category": "security"
        }
      ],
      "mitigation": "You're not just building tests; you're building an adversarial target that must be hard to game.",
      "tags": ["failure-modes", "adversarial", "gaming"]
    },
    {
      "id": 8,
      "title": "Raise the quality bar by investing in non-gameable verification",
      "slug": "adversarial-verification",
      "insight": "You want checks that enforce intent, not just surface-level outputs.",
      "techniques": [
        {
          "name": "Property-based testing",
          "purpose": "Test invariants",
          "examples": ["never decreases", "idempotent", "commutative"]
        },
        {
          "name": "Contract tests",
          "purpose": "Verify service boundary agreements",
          "examples": ["consumer-driven contracts", "schema validation"]
        },
        {
          "name": "Mutation testing",
          "purpose": "Detect weak assertions",
          "examples": ["pitest", "stryker"]
        },
        {
          "name": "Golden tests",
          "purpose": "Snapshot critical transforms",
          "examples": ["output snapshots with careful versioning"]
        },
        {
          "name": "Production-like load tests",
          "purpose": "Avoid synthetic happy paths",
          "examples": ["traffic replay", "production distribution sampling"]
        },
        {
          "name": "Canary + automated rollback gates",
          "purpose": "Wire deployment to actual SLOs",
          "examples": ["error rate thresholds", "latency budgets"]
        }
      ],
      "tags": ["testing", "adversarial", "quality"]
    },
    {
      "id": 9,
      "title": "Use AI primarily to strengthen the verifier, not just generate code",
      "slug": "ai-for-verification",
      "insight": "Better verification improves humans and machines simultaneously.",
      "highLeverageUses": [
        {
          "use": "Generate edge-case tests from requirements and incident history",
          "leverage": "high"
        },
        {
          "use": "Propose invariants and properties from domain models",
          "leverage": "high"
        },
        {
          "use": "Convert vague performance requirement into measurable CI gates",
          "leverage": "medium"
        },
        {
          "use": "Identify coverage gaps (including behavioral gaps, not just line coverage)",
          "leverage": "high"
        }
      ],
      "tags": ["ai", "verification", "compounding"]
    },
    {
      "id": 10,
      "title": "Pipeline as coordination layer is how you avoid drowning in agent exhaust",
      "slug": "coordination-layer",
      "insight": "As AI increases output volume, social systems break first.",
      "problems": [
        "Maintainers/teams get spammed with plausible-but-wrong diffs",
        "People ship changes that feel done locally but violate shared standards"
      ],
      "solution": {
        "rule": "Make CI gates the boundary of attention",
        "effects": [
          "If it doesn't pass the shared pipeline, it doesn't earn review time",
          "If it passes, review becomes higher-signal (architecture and intent, not syntax triage)"
        ]
      },
      "tags": ["coordination", "agents", "review", "attention"]
    },
    {
      "id": 11,
      "title": "Legacy modernization becomes practical via characterization → replacement",
      "slug": "legacy-modernization",
      "insight": "This flips legacy work from touch carefully forever to replace safely with a harness.",
      "playbook": [
        {
          "step": 1,
          "action": "Extract current behavior into characterization tests",
          "detail": "Document what it actually does, not what docs claim"
        },
        {
          "step": 2,
          "action": "Encode the reliable parts as a conformance suite",
          "detail": "Separate stable contracts from implementation details"
        },
        {
          "step": 3,
          "action": "Re-implement behind the suite with modern tech",
          "detail": "New implementation must pass existing conformance"
        },
        {
          "step": 4,
          "action": "Keep the suite as the long-lived contract",
          "detail": "Suite outlives both old and new implementations"
        }
      ],
      "tags": ["legacy", "modernization", "characterization", "strangler-fig"]
    },
    {
      "id": 12,
      "title": "The developer role shifts: from authoring code to curating constraints",
      "slug": "role-shift",
      "insight": "What becomes scarce isn't keystrokes—it's judgment about what must be true.",
      "scarceCommodities": [
        {
          "skill": "Deciding what must be true",
          "action": "Encoding invariants measurably"
        },
        {
          "skill": "Choosing the right proxies",
          "action": "Selecting metrics that correlate with product quality"
        },
        {
          "skill": "Designing durable interfaces",
          "action": "Creating contracts that survive implementation changes"
        },
        {
          "skill": "Diagnosing failures",
          "action": "Understanding when reality diverges from the model"
        }
      ],
      "orgDesignImplication": "Treat verification infrastructure like a product. Staff it like one.",
      "tags": ["roles", "skills", "org-design", "staffing"]
    }
  ],

  "actionItems": {
    "immediate": [
      {
        "action": "Audit current gates for gameability",
        "question": "Can an agent pass without doing the right thing?"
      },
      {
        "action": "Instrument operational correctness as CI failures",
        "detail": "Latency, cost, throughput become first-class gates, not post-deploy dashboards"
      },
      {
        "action": "Build characterization suites for critical legacy components",
        "detail": "Extract actual behavior, not documented behavior"
      },
      {
        "action": "Staff a Verification Platform team",
        "detail": "Same seniority as Infrastructure team"
      }
    ],
    "strategic": [
      {
        "action": "Shift investment from code generation to verification infrastructure",
        "rationale": "Compounding returns on autonomous iteration"
      },
      {
        "action": "Define full-spectrum correctness spec",
        "dimensions": ["functional", "static", "operational", "governance"]
      },
      {
        "action": "Train AI on verification strengthening, not just code generation",
        "uses": ["edge-case generation", "invariant proposal", "coverage gap detection"]
      }
    ]
  },

  "mentalModels": {
    "aiAsSearch": {
      "model": "AI explores implementation variants; pipeline prunes search space",
      "implication": "Tight constraints + fast feedback > smarter prompts"
    },
    "verificationAsProduct": {
      "model": "Pipeline is the product definition",
      "implication": "What you measure becomes law; what you don't becomes negotiable"
    },
    "codeAsDisposable": {
      "model": "Code is the most disposable artifact; verification is the source of truth",
      "implication": "Invest in constraints, not implementations"
    },
    "adversarialTarget": {
      "model": "Tests are adversarial targets that must be hard to game",
      "implication": "Build for intent enforcement, not surface-level output matching"
    }
  },

  "risks": {
    "weakCI": {
      "condition": "If CI is weak",
      "outcome": "AI helps you ship wrong things faster, creating technical debt at machine speed"
    },
    "shallowChecks": {
      "condition": "Shallow or gameable checks",
      "outcome": "Shallow or gameable systems"
    },
    "socialSystemBreakdown": {
      "condition": "High agent output volume without coordination layer",
      "outcome": "Maintainers spammed with plausible-but-wrong diffs"
    }
  },

  "benefits": {
    "strongCI": {
      "condition": "If CI is strong",
      "outcome": "AI turns implementation into a commodity; advantage shifts to whoever encodes intent best"
    },
    "fastVerification": {
      "condition": "Sub-minute feedback loops",
      "outcome": "Agents iterate autonomously without human bottlenecking"
    },
    "fullSpectrumSpec": {
      "condition": "Operational + governance encoded in CI",
      "outcome": "Regression prevention under agent pressure"
    }
  },

  "mappingToFowlerPatterns": {
    "note": "Cross-reference to martinfowler.com guardrails",
    "alignments": [
      {
        "principle": "ci-as-spec",
        "fowlerPatterns": ["deployment-pipeline", "self-testing-code", "continuous-delivery"]
      },
      {
        "principle": "verification-throughput",
        "fowlerPatterns": ["test-impact-analysis", "test-pyramid", "reproducible-builds"]
      },
      {
        "principle": "adversarial-verification",
        "fowlerPatterns": ["contract-test", "consumer-driven-contract", "synthetic-monitoring"]
      },
      {
        "principle": "legacy-modernization",
        "fowlerPatterns": ["strangler-fig", "parallel-change", "branch-by-abstraction", "event-interception"]
      },
      {
        "principle": "coordination-layer",
        "fowlerPatterns": ["mainline-integration", "feature-flag", "canary-release"]
      }
    ]
  }
}
```
<!-- PHILBY_SPEC_END -->

Pipeline as Spec: The AI Dev Unlock

Your CI pipeline is your spec -- not your docs. AI coding is constrained search; the pipeline prunes. Reliability comes from tight constraints + fast feedback, not better prompts.

Core principles:
- Deterministic gates scale; human review does not. Agents are only as trustworthy as the environment's ability to say "no" consistently.
- Verification throughput becomes the bottleneck, not developer throughput.
- Whatever isn't measured becomes negotiable; whatever is measured becomes law.
- "Teaching to the test" is the dominant failure mode; invest in non-gameable verification (property tests, mutation testing, contract tests).

The shift: Developers move from authoring code to curating constraints. Code becomes the most disposable artifact.

The pitch: Your ceiling on AI dev is not the model -- it is your verifier's quality, coverage, and speed. Weak CI means AI ships wrong things faster. Strong CI makes implementation a commodity; advantage goes to whoever encodes intent best.

## Python environment

If you need a Python venv for targets in this repo, run `make .venv/`. It uses `uv` and installs from `requirements.txt`.
