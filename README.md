# Offband Web Components

Portable, browser-native components for Offband properties and client websites.
Each component is built from standard custom elements, owns its JavaScript and
CSS, and can run without the `offband.dev` stylesheet or JavaScript runtime.

This repository grows from real reuse needs. It is not a general design system,
and new components should not be added without an accepted use case.

## Component boundary

A component owns:

- reusable behavior and component-local presentation;
- a documented attribute and property API;
- relevant loading, empty, error, and accessible states;
- safe handling of external data; and
- documented CSS custom properties for host-controlled theming.

A consuming site owns placement, surrounding layout and copy, theme values, and
component configuration. Components must not require an Offband global
stylesheet, `offband.dev/site/assets/js/main.js`, a frontend framework, or
private site data.

## Repository structure

```text
components/
  <component-name>/
    <component-name>.js
    <component-name>.css
    README.md
    example.html
tests/
```

Supporting files may live beside a component when they are part of that
component's implementation. Shared abstractions should be introduced only after
more than one real component needs them.

## Developing a component

Serve the repository root with any static HTTP server. For example:

```sh
python3 -m http.server 8000
```

Then open the component's `example.html` from `http://localhost:8000`. Examples
must import only files from this repository and public services explicitly
documented by the component.

## Public API and compatibility

Component READMEs document supported attributes, matching JavaScript
properties, public methods, CSS custom properties, external requests, and
browser assumptions. Undocumented shadow-DOM structure and internal functions
are not public API.

Patch releases fix compatible defects. Minor releases may add backward-compatible
attributes or behavior. Removing or changing a documented attribute, property,
method, event, or CSS custom property requires a major release.

Components are versioned together until real release pressure demonstrates a
need for a different model. Consumers should pin a release or commit rather than
load the moving `main` branch in production.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). New work requires a maintainer-triaged
issue with a concrete reuse case before implementation.

## License

[MIT](LICENSE)
