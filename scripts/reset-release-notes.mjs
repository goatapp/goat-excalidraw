#!/usr/bin/env node

import fs from "fs";
import path from "path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const versionPath = path.join(repoRoot, "VERSION");
const templatePath = path.join(import.meta.dirname, "release-notes-template.md");
const releasePath = path.join(repoRoot, "RELEASE.md");

function readVersion() {
  try {
    return fs.readFileSync(versionPath, "utf8").trim();
  } catch {
    return "0.0.0";
  }
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[index + 1];
}

function main() {
  const customVersion = getArgValue("--version");
  const prerelease = process.argv.includes("--prerelease");

  const baseVersion = customVersion || readVersion();
  const version =
    prerelease && !baseVersion.endsWith("-dev")
      ? `${baseVersion}-dev`
      : baseVersion;
  const tag = `v${version}`;
  const date = new Date().toISOString().slice(0, 10);

  const template = fs.readFileSync(templatePath, "utf8");
  const content = template
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{TAG}}", tag)
    .replaceAll("{{DATE}}", date);

  fs.writeFileSync(releasePath, content.endsWith("\n") ? content : `${content}\n`);
  console.log(`Wrote ${path.relative(repoRoot, releasePath)} for ${tag}`);
}

main();
