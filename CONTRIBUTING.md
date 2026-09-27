# Contributing

Start with the organization-wide
[Offband contribution guide](https://github.com/offband/Contributing).

Before writing code, open or join an issue and wait for maintainer triage and
acceptance. The issue should identify the concrete consuming site or project,
the proposed public API, scope exclusions, accessibility requirements, and how
the component will be verified independently.

Keep contributions focused:

- use browser-native APIs without framework requirements;
- keep component JavaScript, CSS, documentation, and example together;
- do not depend on an Offband site's global CSS or JavaScript runtime;
- expose host theming through documented CSS custom properties;
- render external data with DOM APIs rather than unsafe HTML interpolation;
- include relevant loading, empty, error, and accessible states; and
- add tests for data boundaries and public behavior.

Pull requests must link an accepted issue, describe compatibility implications,
and list the commands used for verification. Questions and partnership inquiries
can be sent to [aj@offband.dev](mailto:aj@offband.dev).
