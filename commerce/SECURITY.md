# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository when available. If private reporting is unavailable, contact the repository maintainers privately through the GitHub organization before disclosure.

Include:

- affected package and version or commit;
- precise reproduction steps;
- security impact;
- any required deployment configuration;
- a minimal proof of concept where safe.

## Security boundaries

Commerce Core is self-hosted. The deployment owner controls the Worker, database, storage, domains, and secrets.

Do not report provider credentials, raw provider responses, or customer secrets in issues or pull requests. Commerce routes must never accept browser-supplied authoritative totals. Provider callbacks must use the versioned authenticated bridge and idempotency fields.
