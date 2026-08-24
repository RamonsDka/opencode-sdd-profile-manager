# Security policy

## Reporting a vulnerability

Do not disclose exploitable vulnerabilities, credentials, private profile data, or local configuration in a public issue.

Use GitHub private vulnerability reporting when it is available for this repository. Otherwise contact the repository owner privately through the GitHub profile before publishing technical details.

Include:

- affected version or commit;
- attack prerequisites;
- observable impact;
- minimal reproduction with secrets and personal paths removed;
- proposed mitigation, if known.

## Sensitive data

Never commit:

- API keys, access tokens, cookies, or passwords;
- personal OpenCode profiles;
- global OpenCode configuration containing credentials;
- Engram local storage or observations;
- absolute paths containing personal usernames or private project names.

## Security-sensitive boundaries

Changes involving path resolution, profile activation, agent definitions, plugin loading, or preservation of `{file:...}` references require focused regression tests and manual runtime validation.
