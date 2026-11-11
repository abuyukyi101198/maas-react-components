| Index | MA241                        |  |  |
|:------|:-----------------------------|:-|:-|
| Title | Search and Filter in MAAS UI |  |  |

# Abstract

Multiple pages in MAAS UI allow the user to search and filter the data records they view on the respective tables using
a filter dropdown and a search text field. This specification discusses an alternative approach to search and filter UX
in MAAS UI table views.

# Rationale

The current design of MAAS UI’s search and filter function has two separate visual components working in tandem,
however, the simultaneous use of these two components is difficult. Filtering is carried out either by using the filter
dropdown or entering the specific filter syntax into the search text field. The dropdown requires mouse use to navigate
while the search text field is operated solely with the keyboard, meaning that the user must repeatedly switch between
input media for their search experience. Additionally, the filter dropdown displays all possible selections for a given
filter (e.g. all tag names under TAGS section) without suggestions or in-filter search, forcing the user to scroll
through possibly hundreds of filters.

The user can solely use the search text field with the specific syntax for filters (e.g. `zone:(=default)`) but the
syntax is unintuitive without suggestions or autocomplete, and requires the user to know the exact names of the filters
they need.

With searchable views now being migrated to APIv3, there is an opportunity to gradually revamp the search and filter UX
in MAAS UI. The goal of this specification is to outline a proposed improvement to the search and filter functionality
and design while maintaining compatibility with the existing backend and CLI utilities, as it will be introduced in a
MAAS 3.x release without changing the existing search DSL.

# Specification

The proposed redesign introduces a unified, text-based search and filter input field for table views in the MAAS UI,
intended to replace the current split interface of a text field and filter dropdown. This new approach is designed to be
keyboard-centric, discoverable through live suggestions, and compatible with both visual interaction and the
CLI-oriented “power user mode.” The primary aim is to resolve friction caused by the current dual-component interface
while modernizing the UX for future enhancements and APIv3-based search integration.

### **Unified Input Field**

The core of the proposed solution is a single input field placed above the table, which accepts both free-form text and
structured filter expressions. The input field supports fuzzy text search and structured filters in a simplified syntax
that is easy to write and understand. The field is navigable entirely via keyboard, and its behavior dynamically adapts
based on context.

As the user begins typing, the component determines whether the user is outside of any filter expression or writing
inside a filter. When outside, the interface offers live suggestions for available filter names such as STATUS, ZONE, or
TAGS. As the user selects a filter from the suggestion dropdown under the text field, the system automatically inserts
the filter name followed by an opening parenthesis, prompting the user to continue by typing values or operators inside.

Inside a filter, for string or list-based filters, the component offers fuzzy-matched suggestions for values drawn from
real table data (e.g. suggesting “Failed commissioning” when the user types com). For numeric filters such as RAM or
CORES, the system instead suggests valid comparison operators (\<, \>, \<=, \>=, \=), allowing users to write
expressions like RAM (\>8) or DISKS (=2) manually.

### **Filter Syntax**

Filters follow a consistent pattern in the form of `FILTER_NAME(value1, value2, ...)`. The syntax is case-insensitive
and whitespace-tolerant. Filter values are *OR-chained* within the same filter using commas, meaning
`STATUS(deployed, failed)` will match machines in either state. Filters themselves are *AND-chained* when used in
combination, such as `STATUS(deployed) ZONE(default)`. This is simply a more legible version of the existing syntax, and
therefore easily compatible.

Fuzzy text outside of any filter is interpreted as a general name search. The search treats these as free-form search
terms and performs a fuzzy match. While this functionality allows keyword-based searches, it does not support live
suggestions or autocomplete for names.

To ensure a stable experience, the table is only updated when the user completes a search action. Specifically, the
system triggers filtering when a filter expression is closed with a parenthesis or when the name search portion of the
input changes. This prevents incomplete filter input from clearing the table or producing unexpected results, and
reducing the number of API calls.

### **Suggestions and Interaction**

Suggestions are context-aware and displayed in a list beneath the input field. Users can navigate the list using arrow
keys or tab, and insert selections with `Enter`. When selecting a filter name, the current word in progress is replaced
with the full filter followed by an open parenthesis. When inside a filter, the selected value replaces the partial term
the user has typed. The suggestion interface always aligns with the cursor and remains consistent in layout, reserving
visual space even when no suggestions are shown.

Suggestions are disabled in "power user mode" (described below), and are never shown for free-form fuzzy text searches.
This ensures a clean and predictable behavior in all cases.

### **Power User Mode**

The power user mode is an alternate view of the same search input. It can be toggled via a visible button in the UI and
is not activated via keyboard shortcuts. This mode exposes the raw, SQL-style query string that mirrors the
CLI-compatible syntax currently used in MAAS. When toggled, the input field is replaced with the equivalent power user
query, generated from the structured visual query. Users can then copy this query for use in CLI tools or other backend
integrations.

The power user mode allows the UI to maintain backwards compatibility with older versions and other tools which may
still use the older query style.

## User Stories

### **\[1\] As a MAAS administrator, I want to identify machines using a complex query in a short time, so that I can
manage large environments without breaking the existing query integrations and syntax.**

#### **Acceptance criteria:**

* The unified input field supports keyboard-driven search and filter construction.
* When typing outside of any filter expression, the input is interpreted as a free-form fuzzy search across key
  identifying fields (e.g. machine name).
* When typing a filter name, dynamic suggestions appear based on valid filters supported by MAAS (e.g. STATUS, TAGS,
  ZONE).
* When inside a string- or list-based filter expression, fuzzy-matched suggestions for known values appear.
* When inside a numeric filter expression (e.g. RAM, CORES), the user is presented with comparison operators (`<`, `>`,
  `<=`, `>=`, `=`), not autocomplete values.
* Table updates only occur when the name search changes or a filter expression is closed with a parenthesis, to prevent
  empty or unstable UI states.
* A “power user mode” is accessible via a visible button in the UI, and when toggled, rewrites the current query into
  CLI-compatible syntax without suggestions.
* Power user queries generated by the UI are equivalent to queries used in MAAS CLI and are fully copy-paste compatible.

#### **Work items:**

* Implement unified, keyboard-navigable input field above table view.
* Build filter name suggestion logic with fuzzy matching based on user input.
* Implement context-sensitive value suggestions:
    * String-based: fuzzy match from available data (e.g. known statuses or tags).
    * Numeric-based: suggest only valid operators (\>, \<, etc.).
* Implement fuzzy search outside of filters:
    * Match against machine name or identifying fields.
    * No autocomplete suggestions are shown for free-form search terms.
* Ensure input parsing logic tracks cursor location and updates the suggestion context accordingly.
* Implement logic to trigger table updates only when:
    * A new name query is issued.
    * A filter expression is closed.
* Add visible toggle for “power user mode”:
    * When enabled, hides structured input and shows raw query equivalent.
    * Converts current structured query into MAAS CLI-compatible syntax.
    * Supports copy-paste of query text for use in external scripts or terminal.
* Ensure toggling back restores structured input from parsed CLI query (round-trip capable).
* Test compatibility of generated power user queries with MAAS CLI.
* Ensure consistent and predictable behavior for users regardless of current mode.

# Scenarios

### **Scenario 1: Filter with Suggestions**

1. User wants to find deployed machines in the default zone.
2. User focuses on the unified search input above the machine table.
3. User begins typing `sta` and receives live suggestions for filters.
4. User selects `STATUS(` from the list using the keyboard.
5. User types `dep`, receives value suggestions like `Deployed`.
6. User selects `Deployed`, closes filter with a `)`, then adds a space.
7. User types `zone(` and selects `Default` from suggestions.
8. User closes the filter with a `)`, triggering the table update.
9. Matching machines in the “Deployed” status and “Default” zone are shown.

### **Scenario 2: Write Numeric Filter Using Operators**

1. User wants to find machines with more than 8 GB RAM.
2. User types `RAM(` into the search field.
3. User sees operator suggestions: `>`, `>=`, etc.
4. User selects `>` and continues typing `8`.
5. User closes the filter with `)`.
6. Table updates with machines having RAM greater than 8 GB.

### **Scenario 3: Perform Fuzzy Search**

1. User does not remember exact filter or machine tags.
2. User types `dpu` into the search field, without parentheses.
3. Search is interpreted as a free-form fuzzy match.
4. Table shows machines whose name or metadata includes “dpu”.
5. No suggestions are shown for fuzzy search.
6. Table only updates when the text of fuzzy search changes.

### **Scenario 4: Stable Composition of Filters**

1. User is writing a complex filter like `TAG(production,`
2. Before completing the expression, user navigates out of the field or stops typing.
3. No table update is triggered until the closing `)` is typed.
4. Table remains unchanged and avoids showing incomplete results.
5. Once the user types `)`, table updates accordingly.

### **Scenario 5: Switch to Power User Mode**

1. User completes a structured search like `STATUS(Deployed) ZONE(default)`.
2. User clicks “Power User Mode” toggle above the search bar.
3. Search input transforms to CLI-compatible syntax: `status:(=deployed) zone:(=default)`.
4. User copies the query for use in scripts or CLI commands.
5. User can toggle back to return to the structured UI view.
6. Original visual query is restored, unchanged.

## Components

### **API Changes**

The new search interface relies on minimal backend enhancements, with most of the query construction, filter logic, and
value suggestion behavior handled entirely on the frontend. Two main API interfaces are required to support the
functionality:

**1\. Filter Value Suggestion Endpoint**

The frontend will call dedicated endpoints for specific filter types to retrieve real-time suggestions based on partial
user input. These endpoints follow the pattern:

* `/MAAS/a/v3/autocomplete/?q=<partial>&entity=<filter>&limit=<limit>`

For example, to fetch zone name suggestions starting with "def", the frontend will query:

* `/MAAS/a/v3/autocomplete/?q=def&entity=zone.name&limit=5`

The returned values are used to populate the suggestion dropdown while typing inside a filter. This applies to filters
like `zone`, `tags`, `owner`, etc.

* Parameters:
    * `q`: Optional partial input from the user.
    * `entity`: Name of the filtering entity and field.
    * `limit`: Optional maximum number of suggestions to return.
* Response:
    * A JSON object with a single key, `suggestions`, containing a list of matching strings.

The frontend will hardcode the list of which filters support value suggestions, and will use these endpoints
accordingly.

**2\. Unified Search Execution Endpoint**

Search queries are submitted to the existing machines endpoint in the following form:

* `/MAAS/a/v3/machines/?q=status(deployed,commissioning)&zone(default)&dpu`

Here:

* `q` is the user’s full query string, including all structured filters.
* Each filter is included as an &-chained parameter within the same key `q`, following the expected backend parsing
  format.
* The `&dpu` flag (without a value) indicates the content of the fuzzy full-text search in addition to filter-based
  querying.

The backend will parse these query strings using the same rules as the existing CLI-compatible query syntax. Power user
mode does not change the endpoint or query structure—it simply exposes the raw syntax directly to the user for
readability and copy/paste into CLI tools.

This endpoint is used by both modes and supports both structured and free-form search inputs.

* Parameters:
    * `q`: One or more structured filters in the form of `filter(values)` syntax.
    * `fuzzy`: Optional flag to enable general text matching outside of structured filters.
* Response:
    * A standard list of filtered machine objects based on the query.
* Error handling:
    * Invalid filter names or malformed syntax will return 400-level error responses.
    * Unknown filter values are silently ignored unless explicitly handled.

### **UI Changes**

The UI will replace the current two-part filtering system with a single, unified input component above the relevant
tables. This new component supports both free-form and structured search using keyboard navigation, and introduces
contextual, inline suggestions to guide the user through query construction.

#### **Unified Search Component**

* Accepts structured filters (e.g. `status(failed)`) and fuzzy text.
* Tracks cursor position to detect whether the user is writing inside a filter or outside.
* When outside filters, allows free-form fuzzy search across entire machine rows or selected fields like `name`,
  depending on the view.
* When inside a filter, shows context-aware value suggestions based on the filter and partial input (via API).
* Prevents table from updating until the user completes a filter or changes the fuzzy search term.

#### **Suggestion Logic (Frontend)**

* The full list of available filters is hardcoded per view (e.g. machine list, controller list).
* Suggestions for filter names and numeric operators are derived from this static list.
* Only value suggestions (for specific filters) come from the backend.

#### **Power User Mode**

* Activated via an explicit toggle button in the UI.
* Converts the structured query into the CLI-compatible power user syntax and displays it in a read-only input field.
* Allows users to copy the raw query string for use in command-line tools.
* The conversion logic is implemented via a parser utility in the frontend, supporting two-way translation (structured ↔
  raw).

# Further Information

## Future Work

If approved, the spec will require a re-design of the filter dropdown and search text field pair as a unified text field
with a suggestion dropdown, alongside distinctive filter tags to visually separate query elements.

## Dependencies

The complete implementation of this specification requires a full APIv3 migration and additional endpoints for filter
value suggestions.

## References

If you want to get a feel of how this keyboard-only search would behave, check
out [https\://github.com/abuyukyi101198/poc/tree/main/search](https://github.com/abuyukyi101198/poc/tree/main/search).  
Existing search and filter component in
Vanilla [https\://canonical.github.io/react-components/?path=/story/components-searchandfilter--default](https://canonical.github.io/react-components/?path=/story/components-searchandfilter--default)

# Spec History and Changelog

Please be thorough when recording changes and progress with the spec itself and the work resulting from it. Record every
meeting, attendees and conclusions from the meeting.

## Feedback from UX

- Try not to lose UI driven interaction, current design system focuses on this
- Are there screens/user groups that do not need such a sophisticated search?
- Could look at patterns in code editors for completions
- Completion could also result in both (e.g. region \+ the region we’re searching for)
- Need to check if people know the mental model, do they think in “I’m looking for a fabric named xy” instead of “I’m
  looking for that xy thing”

