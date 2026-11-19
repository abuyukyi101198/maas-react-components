import { useEffect, useRef, useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type {
  ColumnDef,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table";

import { GenericTable } from "@/lib/components/GenericTable/GenericTable";
import { QueryInput } from "@/lib/components/QueryInput/QueryInput";
import {
  demoFields,
  demoMachines,
  getDemoFilterSuggestions,
  getDemoSuggestions,
  listDemoMachines,
  searchDemoMachines,
  type DemoGroup,
  type DemoListingRequest,
  type DemoMachine,
  type DemoPersona,
  type DemoSort,
} from "@/lib/components/QueryInput/queryDemo";
import {
  fieldsAtContext,
  validateQuery,
  type QueryExpression,
} from "@/lib/components/QueryInput/queryModel";

import "./QueryInput.stories.scss";

type DemoProps = {
  delayMs: number;
  failSuggestions: boolean;
  failExecution: boolean;
  persona: DemoPersona;
  disabled?: boolean;
  isLoading?: boolean;
};
type AppliedQuery = { text: string; expression: QueryExpression };

const EMPTY_MACHINES: DemoMachine[] = [];
const machineColumns: ColumnDef<DemoMachine, Partial<DemoMachine>>[] = [
  { accessorKey: "hostname", header: "Hostname", enableMultiSort: false },
  {
    accessorKey: "status",
    header: "Status / architecture",
    enableMultiSort: false,
    cell: ({ row: { original: item } }) => (
      <>
        {item.status}
        <br />
        {item.architecture}
      </>
    ),
  },
  {
    accessorKey: "pool",
    header: "Pool / zone / owner",
    enableSorting: false,
    cell: ({ row: { original: item } }) => (
      <>
        {item.pool} / {item.zone}
        <br />
        Owner: {item.owner ?? "unknown"}
      </>
    ),
  },
  {
    accessorKey: "disks",
    header: "Disks (bytes)",
    enableSorting: false,
    cell: ({ row: { original: item } }) =>
      item.disks
        .map((disk) => `${disk.name}: ${disk.size ?? "unknown"}`)
        .join("; ") || "No disks",
  },
  {
    accessorKey: "fabrics",
    header: "Connected fabric → VLANs",
    enableSorting: false,
    cell: ({ row: { original: item } }) =>
      item.fabrics
        .map(
          (fabric) => `${fabric.name} → ${fabric.vlans.join(", ") || "(none)"}`,
        )
        .join("; ") || "No connections",
  },
];

const DemoHarness = ({
  delayMs,
  failSuggestions,
  failExecution,
  persona,
  disabled,
  isLoading,
}: DemoProps) => {
  const resultsRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState("");
  const [context, setContext] = useState("");
  const [token, setToken] = useState("");
  const [applied, setApplied] = useState<AppliedQuery | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "hostname", desc: false },
  ]);
  const sortField = sorting[0]?.id === "status" ? "status" : "hostname";
  const sort: DemoSort = sorting[0]?.desc ? `-${sortField}` : sortField;
  const [group, setGroup] = useState<DemoGroup>("none");
  const [selected, setSelected] = useState<RowSelectionState>({});
  useEffect(() => setPage(1), [persona]);

  const validation = validateQuery(search, demoFields);
  const activeField = fieldsAtContext(demoFields, context);
  const contextParts = context.split(".");
  const suggestionRequest = {
    entity: "machines" as const,
    persona,
    filter: activeField?.name ?? "",
    ...(contextParts.length === 2 ? { parent: contextParts[0] } : {}),
    q: token,
    limit: 15,
  };
  const values = useQuery({
    queryKey: [
      "query-demo",
      "suggestions",
      suggestionRequest,
      delayMs,
      failSuggestions,
    ],
    queryFn: ({ signal }) =>
      getDemoSuggestions(suggestionRequest, {
        delayMs,
        fail: failSuggestions,
        signal,
      }),
    enabled: Boolean(activeField),
    retry: false,
    gcTime: 30000,
  });
  const suggestions = [
    ...getDemoFilterSuggestions(context, token),
    ...(activeField && !values.isError
      ? (values.data?.suggestions ?? []).map((value) => ({
          value,
          type: activeField.name,
          ...(activeField.type === "quantity"
            ? { kind: "quantity" as const }
            : {}),
        }))
      : []),
  ];

  const listingRequest: DemoListingRequest = {
    entity: "machines",
    persona,
    page,
    pageSize,
    sort,
    group,
  };
  const searchRequest = applied
    ? { ...listingRequest, query: applied.expression }
    : null;
  // Switching keys releases the previous observer; disabling it would retain its cache.
  const results = useQuery({
    queryKey: [
      "query-demo",
      applied ? "search" : "listing",
      searchRequest ?? listingRequest,
      delayMs,
      failExecution,
    ],
    queryFn: ({ signal }) =>
      searchRequest
        ? searchDemoMachines(searchRequest, {
            delayMs,
            fail: failExecution,
            signal,
          })
        : listDemoMachines(listingRequest, {
            delayMs,
            fail: failExecution,
            signal,
          }),
    gcTime: applied ? 30000 : 300000,
    retry: false,
  });

  const submit = (text: string, expression: QueryExpression) => {
    // Validate the entire submitted text, never the analyzer's incomplete-token prefix.
    if (!validateQuery(text, demoFields).expression) return;
    setApplied({ text, expression });
    setPage(1);
  };

  return (
    <div className="query-input-demo">
      <QueryInput
        search={search}
        setSearch={setSearch}
        setContext={setContext}
        setToken={setToken}
        fields={demoFields}
        suggestions={suggestions}
        placeholder="Search machines..."
        disabled={disabled}
        isLoading={isLoading || (Boolean(activeField) && values.isFetching)}
        suggestionError={
          activeField && values.isError ? values.error.message : undefined
        }
        onRetry={() => {
          void values.refetch();
        }}
        noMatchingValues={
          Boolean(activeField) &&
          values.isSuccess &&
          values.data.suggestions.length === 0
        }
        onSubmit={submit}
        onClear={() => {
          setApplied(null);
          setPage(1);
        }}
      />

      <p
        aria-label="Query details"
        className="u-text--muted u-no-margin--bottom"
      >
        {validation.expression
          ? "Valid query"
          : validation.error
            ? "Invalid or incomplete"
            : "Empty query"}
        {" · "}
        {applied ? "Applied search" : "Normal listing"}
        {applied && search !== applied.text ? " · Unapplied changes" : ""}
      </p>

      <section
        aria-label="Machine results"
        className="query-input-demo__results"
        ref={resultsRef}
      >
        <div className="query-input-demo__toolbar">
          <label className="query-input-demo__group">
            Group machines
            <select
              value={group}
              onChange={(event) => {
                setGroup(event.target.value as DemoGroup);
                setPage(1);
              }}
            >
              <option value="none">No grouping</option>
              <option value="status">Status</option>
              <option value="pool">Pool</option>
            </select>
          </label>
          <span>
            {demoMachines.filter((machine) => selected[machine.id]).length}{" "}
            selected
          </span>
          {results.data && (
            <span aria-live="polite">
              {results.data.total} matching machines
            </span>
          )}
        </div>
        {results.isError ? (
          <div role="alert">
            <p>{results.error.message}</p>
            <button
              type="button"
              onClick={() => {
                void results.refetch();
              }}
            >
              Retry results
            </button>
          </div>
        ) : (
          <>
            {results.data && results.data.groups.length > 0 && (
              <p className="u-no-margin--bottom">
                Groups (full result):{" "}
                {results.data.groups
                  .map(({ name, count }) => `${name}: ${count}`)
                  .join("; ")}
              </p>
            )}
            <GenericTable
              key={group}
              aria-label={
                applied ? "Applied query results" : "Normal machine listing"
              }
              columns={machineColumns}
              data={results.data?.items ?? EMPTY_MACHINES}
              isLoading={results.isPending}
              variant="full-height"
              containerRef={resultsRef}
              groupBy={group === "none" ? undefined : [group]}
              showChevron
              sorting={sorting}
              setSorting={(update) => {
                setSorting(update);
                setPage(1);
              }}
              selection={{
                rowSelection: selected,
                setRowSelection: setSelected,
                rowSelectionLabelKey: "hostname",
              }}
              pagination={
                results.data && results.data.total > 0
                  ? {
                      currentPage: page,
                      setCurrentPage: setPage,
                      itemsPerPage: pageSize,
                      totalItems: results.data?.total ?? 0,
                      dataContext: "machines",
                      isPending: results.isFetching,
                      pageSizes: [5, 10, 20],
                      handlePageSizeChange: (size) => {
                        setPageSize(size);
                        setPage(1);
                      },
                    }
                  : undefined
              }
              noData="No matching machines. Edit the draft and Submit, or Clear to return to the listing."
            />
          </>
        )}
      </section>
    </div>
  );
};

const QueryDemo = (props: DemoProps) => {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      <DemoHarness {...props} />
    </QueryClientProvider>
  );
};

const meta = {
  title: "Components/QueryInput",
  component: QueryDemo,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Frontend-only machine fixture. Submit applies the draft; Clear restores the listing. Storybook controls simulate permissions, latency, and failures.",
      },
    },
  },
  args: {
    delayMs: 250,
    failSuggestions: false,
    failExecution: false,
    persona: "administrator",
    disabled: false,
    isLoading: false,
  },
  argTypes: {
    delayMs: { control: { type: "range", min: 0, max: 3000, step: 100 } },
    failSuggestions: { control: "boolean" },
    failExecution: { control: "boolean" },
    persona: { control: "select", options: ["administrator", "operator"] },
    disabled: { control: "boolean" },
    isLoading: { control: "boolean" },
  },
} satisfies Meta<typeof QueryDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
