#!/usr/bin/env node
/*
 * Jest launcher with a compatibility shim: Jest 30 renamed the `--testPathPattern`
 * CLI flag to `--testPathPatterns`. The mission's services.yaml and feature
 * contracts invoke the singular form, so we transparently map it here while
 * staying on the latest Jest. The plural form and every other argument pass
 * through untouched.
 */
const { run } = require('jest');

const args = process.argv.slice(2).map((arg) => {
  if (arg === '--testPathPattern') {
    return '--testPathPatterns';
  }
  if (arg.startsWith('--testPathPattern=')) {
    return arg.replace('--testPathPattern=', '--testPathPatterns=');
  }
  return arg;
});

run(args);
