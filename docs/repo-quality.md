# Public Repo Quality Baseline

This repo follows a small public-repo baseline drawn from current open-source
repository guidance.

## Baseline

- Clear README with purpose, install, usage, safety posture, and links.
- Open-source license at the repository root.
- Contribution guide with setup and project constraints.
- Code of conduct.
- Security policy and vulnerability reporting guidance.
- Issue and pull request templates.
- CI for validation and tests.
- Project docs that explain architecture, usage, security, and roadmap.

## Sources Used

- GitHub recommends README, license, contribution guidelines, code of conduct,
  and security practices for healthy repositories:
  <https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories>
- GitHub license guidance recommends including a license file so users know the
  terms:
  <https://docs.github.com/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository/>
- Open Source Guides recommends starting with a license, README, contributing
  guidelines, and code of conduct:
  <https://opensource.guide/starting-a-project/>
- Google's open-source release guidance emphasizes a useful README, license,
  contribution guidance, and security disclosure process:
  <https://opensource.google/docs/releasing/preparing/>

## Project-Specific Quality Bar

Because this plugin can send repository context to another model provider, the
public quality bar includes security documentation and conservative defaults,
not just install instructions.

Every substantial change should preserve:

- read-only default posture
- in-session `claude_code` delegation as the public API
- the internal runtime kept debuggable for maintainers
- fake-Claude tests that do not spend provider credits
- explicit budget and timeout controls
