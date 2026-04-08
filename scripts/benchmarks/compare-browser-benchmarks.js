import { appendFile, readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

// Bootstrap scenarios use "min" because every iteration measures the same
// cold-start work — there's no warm-up curve. The minimum reflects the true
// cost with the least CI noise (GC pauses, CPU throttling, noisy neighbors).
// Load scenarios keep "median" since content parsing has more natural variance.
const DEFAULT_THRESHOLD = {
  absoluteRegressionMs: 20,
  relativeRegression: 0.2,
  metric: "median",
}

const SCENARIO_THRESHOLDS = {
  "bootstrap-empty-editor": {
    absoluteRegressionMs: 20,
    relativeRegression: 0.25,
    metric: "min",
  },
  "bootstrap-many-editors": {
    absoluteRegressionMs: 40,
    relativeRegression: 0.25,
    metric: "min",
  },
  "load-large-content": {
    absoluteRegressionMs: 25,
    relativeRegression: 0.2,
    metric: "median",
  },
  "load-many-attachments": {
    absoluteRegressionMs: 25,
    relativeRegression: 0.2,
    metric: "median",
  },
  "load-very-large-table": {
    absoluteRegressionMs: 30,
    relativeRegression: 0.2,
    metric: "median",
  },
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})

async function main() {
  const { baselinePath, currentPath } = parseArgs(process.argv.slice(2))
  const baselineResults = await loadBenchmarkResults(baselinePath)
  const currentResults = await loadBenchmarkResults(currentPath)
  const comparison = compareResults({ baselineResults, currentResults })
  const summary = buildSummary(comparison, { baselinePath, currentPath })

  console.log(summary.consoleOutput)

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary.markdown}\n`)
  }

  if (comparison.failures.length > 0) {
    process.exitCode = 1
  }
}

function parseArgs(args) {
  if (args.length !== 2) {
    throw new Error("Usage: node scripts/benchmarks/compare-browser-benchmarks.js <baseline.json> <current.json>")
  }

  return {
    baselinePath: path.resolve(args[0]),
    currentPath: path.resolve(args[1]),
  }
}

async function loadBenchmarkResults(filePath) {
  const contents = await readFile(filePath, "utf8")
  const parsedContents = JSON.parse(contents)

  if (!Array.isArray(parsedContents.scenarios)) {
    throw new Error(`Invalid browser benchmark result file: ${filePath}`)
  }

  return parsedContents
}

function compareResults({ baselineResults, currentResults }) {
  const baselineScenarios = new Map(baselineResults.scenarios.map((scenario) => [ scenario.name, scenario ]))
  const currentScenarios = new Map(currentResults.scenarios.map((scenario) => [ scenario.name, scenario ]))
  const names = new Set([ ...baselineScenarios.keys(), ...currentScenarios.keys() ])
  const entries = []
  const failures = []

  for (const name of [ ...names ].sort()) {
    const baselineScenario = baselineScenarios.get(name)
    const currentScenario = currentScenarios.get(name)

    if (!baselineScenario) {
      entries.push({
        currentValue: currentScenario.stats.median,
        name,
        status: "new",
      })
      continue
    }

    if (!currentScenario) {
      const failure = {
        name,
        reason: "scenario missing from current benchmark results",
        status: "missing",
      }

      entries.push(failure)
      failures.push(failure)
      continue
    }

    const threshold = SCENARIO_THRESHOLDS[name] || DEFAULT_THRESHOLD
    const metric = threshold.metric || "median"
    const baselineValue = baselineScenario.stats[metric]
    const currentValue = currentScenario.stats[metric]
    const deltaMs = roundNumber(currentValue - baselineValue)
    const deltaRatio = baselineValue === 0
      ? null
      : roundNumber(deltaMs / baselineValue)
    const isRegression = deltaMs > threshold.absoluteRegressionMs &&
      deltaRatio !== null &&
      deltaRatio > threshold.relativeRegression

    const entry = {
      baselineValue,
      currentValue,
      deltaMs,
      deltaRatio,
      metric,
      name,
      status: statusForDelta(deltaMs, isRegression),
      threshold,
    }

    entries.push(entry)

    if (isRegression) {
      failures.push(entry)
    }
  }

  return { entries, failures }
}

function buildSummary(comparison, { baselinePath, currentPath }) {
  const consoleLines = [
    "Browser benchmark comparison:",
    `baseline: ${baselinePath}`,
    `current: ${currentPath}`,
    "",
  ]

  const markdownLines = [
    "## Browser Benchmark Comparison",
    "",
    `Baseline: \`${baselinePath}\`  `,
    `Current: \`${currentPath}\``,
    "",
    "| Scenario | Metric | Baseline | Current | Delta | Threshold | Status |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
  ]

  for (const entry of comparison.entries) {
    const metricLabel = entry.metric || "median"
    const thresholdLabel = formatThreshold(entry.threshold)
    const deltaLabel = formatDelta(entry)
    const baselineLabel = formatValue(entry.baselineValue)
    const currentLabel = formatValue(entry.currentValue)

    consoleLines.push([
      `- ${entry.name}`,
      `baseline=${baselineLabel}`,
      `current=${currentLabel}`,
      `delta=${deltaLabel}`,
      `threshold=${thresholdLabel}`,
      `status=${entry.status}`,
    ].join(" "))

    markdownLines.push(`| ${entry.name} | ${metricLabel} | ${baselineLabel} | ${currentLabel} | ${deltaLabel} | ${thresholdLabel} | ${entry.status} |`)
  }

  markdownLines.push("")

  if (comparison.failures.length === 0) {
    consoleLines.push("")
    consoleLines.push("No benchmark regressions exceeded the configured thresholds.")
    markdownLines.push("No benchmark regressions exceeded the configured thresholds.")
  } else {
    consoleLines.push("")
    consoleLines.push(`${comparison.failures.length} benchmark regression(s) exceeded the configured thresholds.`)
    markdownLines.push(`${comparison.failures.length} benchmark regression(s) exceeded the configured thresholds.`)
  }

  return {
    consoleOutput: consoleLines.join("\n"),
    markdown: markdownLines.join("\n"),
  }
}

function statusForDelta(deltaMs, isRegression) {
  if (isRegression) return "regressed"
  if (deltaMs < 0) return "improved"
  if (deltaMs > 0) return "stable"
  return "unchanged"
}

function formatValue(value) {
  if (typeof value !== "number") return "n/a"
  return `${value.toFixed(3)} ms`
}

function formatDelta(entry) {
  if (typeof entry.deltaMs !== "number") return "n/a"

  if (entry.deltaRatio === null) {
    return `${entry.deltaMs.toFixed(3)} ms`
  }

  const sign = entry.deltaMs > 0 ? "+" : ""
  return `${sign}${entry.deltaMs.toFixed(3)} ms (${sign}${(entry.deltaRatio * 100).toFixed(1)}%)`
}

function formatThreshold(threshold) {
  if (!threshold) return "n/a"

  return `>${threshold.absoluteRegressionMs} ms and >${(threshold.relativeRegression * 100).toFixed(0)}%`
}

function roundNumber(value) {
  return Number.parseFloat(value.toFixed(3))
}
