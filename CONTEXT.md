# viz

viz turns structured descriptions into self-contained browser pages for reading technical material and collecting decisions.

## Language

**Page**:
A self-contained browser document rendered from one page description.
_Avoid_: App, site, artifact

**Theme**:
A named visual treatment that changes a page’s presentation without changing its content or interactions. A theme may also change typography, spacing, block shape, and composition.
_Avoid_: Skin, template

**Theme choice**:
A user preference naming a theme or requesting a random selection with a system, light, or dark mode policy.
_Avoid_: Theme, when referring to a random choice

**Initial theme**:
The concrete theme selected when a page first opens. Its initial appearance follows the theme choice’s mode policy.
_Avoid_: Default theme, configured theme

**Mode policy**:
The rule that makes an initial appearance follow the operating system, stay locked to light or dark, or remain independent of that distinction.
_Avoid_: Color behavior

**Independent appearance**:
A theme appearance that does not claim to be light or dark and does not react to the operating-system color mode.
_Avoid_: Custom mode

**Active appearance**:
The concrete theme and its light, dark, or independent appearance currently shown in an open page. It may differ from the initial theme after the user uses the theme switcher.
_Avoid_: Active theme, selected theme

**Partial submission**:
A submitted answer set that contains at least one decision but omits other unanswered decision IDs.
_Avoid_: Incomplete submission

**Surprise me**:
A theme-switcher action that replaces the active appearance with one from a different concrete theme for the current page.
_Avoid_: Random theme

**Test page**:
The built-in representative page rendered by `viz test` for a quick visual and interaction check.
_Avoid_: Demo page, fixture
