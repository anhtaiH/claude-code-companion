# Security Policy

## Supported Versions

The `main` branch is the supported development line until formal releases
exist.

## Reporting A Vulnerability

Do not open a public issue for a vulnerability that includes secrets, private
repository content, or exploit details.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for the repo.
2. If private reporting is not available, open a public issue with only a brief
   sanitized summary and ask for a private contact path.

## Scope

Security-sensitive areas include:

- Claude tool permissions
- dangerous CLI flags
- shell command construction
- state persistence
- log redaction
- secret-like output handling
- prompt content boundaries

## Current Behavior

V1 asks Claude Code for review, diagnosis, planning, and research. It does not
ask Claude Code to edit files.
