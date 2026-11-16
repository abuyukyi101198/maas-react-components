import { type CSSProperties, useState } from "react";

import { Meta, StoryObj } from "@storybook/react-vite";

import { QueryInput, Suggestion } from "@/lib";
import {
  analyzeQuery,
  type QueryTokenKind,
  tokenizeQuery,
  toDottedQuery,
} from "@/lib/components/QueryInput/queryAnalyzer";

// Machine shape from maas-ui (src/app/store/machine/types/base.ts). Nested refs
// such as zone and pool are { id, name } objects, so their values come from
// `.name`. A VLAN belongs to a fabric, so VLANs are nested under their fabric
type ModelRef = { id: number; name: string };

type FabricFixture = ModelRef & { vlans: ModelRef[] };

type MachineFixture = {
  hostname: string;
  status: string;
  owner: string;
  architecture: string;
  pool: ModelRef;
  zone: ModelRef;
  fabrics: FabricFixture[];
  spaces: string[];
};

const fabric0: FabricFixture = {
  id: 0,
  name: "fabric-0",
  vlans: [{ id: 0, name: "default" }],
};

const fabric1: FabricFixture = {
  id: 1,
  name: "fabric-1",
  vlans: [
    { id: 1, name: "default" },
    { id: 2, name: "mgmt" },
  ],
};

const machines: MachineFixture[] = [
  {
    hostname: "mlod2s001",
    status: "Deployed",
    owner: "maas",
    architecture: "amd64/generic",
    pool: { id: 1, name: "default" },
    zone: { id: 1, name: "default" },
    fabrics: [fabric0],
    spaces: ["outer"],
  },
  {
    hostname: "mlod2s002",
    status: "Ready",
    owner: "acbuyukyilmaz",
    architecture: "amd64/generic",
    pool: { id: 2, name: "reserve" },
    zone: { id: 2, name: "danger" },
    fabrics: [fabric1],
    spaces: ["empty"],
  },
  {
    hostname: "eu6ww001",
    status: "Deployed",
    owner: "maas",
    architecture: "arm64/generic",
    pool: { id: 2, name: "reserve" },
    zone: { id: 1, name: "default" },
    fabrics: [fabric0, fabric1],
    spaces: ["outer"],
  },
];

// The field each filter's values are read from. A complex value defaults to
// its name, so zone and pool read `.name`. A filter with a parent is suggested
// only inside that parent
const FILTER_FIELDS: {
  filter: string;
  path: string;
  parent?: string;
  read: (machine: MachineFixture) => string[];
}[] = [
  { filter: "status", path: "status", read: (m) => [m.status] },
  { filter: "owner", path: "owner", read: (m) => [m.owner] },
  { filter: "pool", path: "pool.name", read: (m) => [m.pool.name] },
  { filter: "zone", path: "zone.name", read: (m) => [m.zone.name] },
  {
    filter: "architecture",
    path: "architecture",
    read: (m) => [m.architecture],
  },
  {
    filter: "fabric",
    path: "fabrics.name",
    read: (m) => m.fabrics.map((f) => f.name),
  },
  {
    filter: "vlan",
    path: "fabrics.vlans.name",
    parent: "fabric",
    read: (m) => m.fabrics.flatMap((f) => f.vlans.map((v) => v.name)),
  },
  { filter: "space", path: "spaces", read: (m) => m.spaces },
];

const rootFilterNames = FILTER_FIELDS.filter((f) => f.parent === undefined).map(
  (f) => f.filter,
);

const subFilterNames = (parent: string) =>
  FILTER_FIELDS.filter((f) => f.parent === parent).map((f) => f.filter);

const machineSuggestions: Suggestion[] = FILTER_FIELDS.flatMap(
  ({ filter, read }) => [
    { value: filter, type: "filter" },
    ...[...new Set(machines.flatMap(read))].map((value) => ({
      value,
      type: filter,
    })),
  ],
);

const meta: Meta<typeof QueryInput> = {
  title: "Components/QueryInput",
  component: QueryInput,
  parameters: {
    docs: {
      description: {
        component:
          "QueryInput is a search field component with externally controlled " +
          "assistive suggestion and insertion features. It's designed to construct " +
          "queries using autocomplete and suggestion endpoints managed by external queries.",
      },
    },
  },
  tags: ["autodocs"],
  args: {
    suggestions: machineSuggestions,
  },
  argTypes: {
    disabled: {
      description: "Determines the disabled state",
      control: { type: "boolean", default: false },
      table: {
        type: { summary: "boolean" },
        defaultValue: { summary: "false" },
      },
    },
    search: {
      description:
        "Externally controlled search query string. Must be passed in to the component for token detection",
      control: false,
      table: {
        type: { summary: "string" },
        required: true,
      },
    },
    setSearch: {
      description: "State setter function for updating search query string",
      control: false,
      table: {
        type: { summary: "Dispatch<SetStateAction<string>>" },
        required: true,
      },
    },
    setContext: {
      description: "State setter function for updating context string",
      control: false,
      table: {
        type: { summary: "Dispatch<SetStateAction<string>>" },
        required: true,
      },
    },
    setToken: {
      description:
        "State setter function for updating currently editing token string",
      control: false,
      table: {
        type: { summary: "Dispatch<SetStateAction<string>>" },
        required: true,
      },
    },
    suggestions: {
      description: "Externally controlled suggestion array",
      control: false,
      table: {
        type: { summary: "Suggestion[]" },
        required: true,
      },
    },
    isLoading: {
      description: "Determines the suggestion loading state",
      control: { type: "boolean", default: false },
      table: {
        type: { summary: "boolean" },
        defaultValue: { summary: "false" },
      },
    },
    placeholder: {
      description: "Search field placeholder text",
      control: { type: "text" },
      table: {
        type: { summary: "string" },
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof QueryInput>;

const TOKEN_STYLES: Record<QueryTokenKind, CSSProperties> = {
  filter: { backgroundColor: "var(--vf-color-background-neutral-active)" },
  operator: {
    backgroundColor: "var(--vf-color-background-information-default)",
    fontWeight: 600,
  },
  value: { backgroundColor: "var(--vf-color-background-positive-default)" },
  fuzzy: { color: "var(--vf-color-text-muted)", fontStyle: "italic" },
  text: {},
};

// A query as text, with each token kind colored
const ParsedQuery = ({ label, query }: { label: string; query: string }) => (
  <div>
    <p className="u-text--muted">{label}</p>
    <pre style={{ whiteSpace: "pre-wrap" }}>
      {query === "" ? (
        <span className="u-text--muted">(empty)</span>
      ) : (
        tokenizeQuery(query).map((token, index) => (
          <span key={index} style={TOKEN_STYLES[token.kind]}>
            {token.text}
          </span>
        ))
      )}
    </pre>
  </div>
);

// Lists each filter's source field and the values read from the machines
const MachineFieldTable = () => (
  <div>
    <p className="u-text--muted">Machine fields</p>
    <table>
      <thead>
        <tr>
          <th>Filter</th>
          <th>Field</th>
          <th>Values</th>
        </tr>
      </thead>
      <tbody>
        {FILTER_FIELDS.map(({ filter, path, read }) => (
          <tr key={filter}>
            <td>{filter}</td>
            <td>
              <code>{path}</code>
            </td>
            <td>{[...new Set(machines.flatMap(read))].join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const Default: Story = {
  render: (args) => {
    const [search, setSearch] = useState<string>("");
    const [context, setContext] = useState<string>("");
    const [token, setToken] = useState<string>("");

    let suggestions: Suggestion[] = args.suggestions;

    if (context.length === 0) {
      // Outside any filter, suggest root filter names only
      suggestions = suggestions.filter(
        (s) => s.type === "filter" && rootFilterNames.includes(s.value),
      );
    } else {
      // Inside a filter, suggest its values and its sub-filter names. Nested
      // filters use the innermost name, e.g. vlan in fabric.vlan
      const innermost = context.split(".").pop() ?? "";
      const subFilters = subFilterNames(innermost);
      suggestions = suggestions.filter(
        (s) =>
          s.type === innermost ||
          (s.type === "filter" && subFilters.includes(s.value)),
      );
    }

    if (token.length > 0) {
      suggestions = suggestions.filter((s) =>
        s.value.toLowerCase().includes(token.toLowerCase()),
      );
    }

    return (
      <div
        style={{ display: "flex", flexDirection: "column", minHeight: "40rem" }}
      >
        <QueryInput
          search={search}
          setSearch={setSearch}
          setContext={setContext}
          setToken={setToken}
          suggestions={suggestions}
          placeholder="Search machines..."
        />
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <ParsedQuery label="Raw query" query={search} />
          <ParsedQuery
            label="Valid query"
            query={toDottedQuery(analyzeQuery(search).completeQuery)}
          />
          <MachineFieldTable />
        </div>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => {
    return (
      <QueryInput
        disabled
        placeholder="Search machines..."
        search={""}
        setSearch={() => {}}
        setContext={() => {}}
        setToken={() => {}}
        suggestions={[]}
      />
    );
  },
};

export const Loading: Story = {
  render: (args) => {
    const [search, setSearch] = useState<string>("");
    const [, setContext] = useState<string>("");
    const [_, setToken] = useState<string>("");

    return (
      <QueryInput
        isLoading
        placeholder="Search machines..."
        search={search}
        setSearch={setSearch}
        setContext={setContext}
        setToken={setToken}
        suggestions={args.suggestions}
      />
    );
  },
};
