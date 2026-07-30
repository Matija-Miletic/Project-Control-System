# Binding project architecture rule

The project must remain independent and able to operate in complete isolation
by opening `index.html`.

Do not add a framework, build step, package dependency, CDN, hosted runtime,
cloud database, external API, account requirement, telemetry, remote font,
network request or vendor-specific service unless all of the following are
true:

1. a stated functional requirement cannot reasonably be met with the existing
   browser-native implementation;
2. at least two dependency-free or lower-dependency approaches have been
   assessed and found inadequate;
3. the exact dependency, failure modes, operating cost, migration path and
   lock-in risk have been explained in plain language; and
4. the user has given explicit approval for that specific dependency.

Convenience, developer preference, fashion, familiarity or easier hosting are
not sufficient reasons.

Any approved dependency must be optional or replaceable wherever practicable,
and the independent standalone edition must be preserved unless the user
explicitly approves removing it.
