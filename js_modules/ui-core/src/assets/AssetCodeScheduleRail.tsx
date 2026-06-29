import {Box, Colors, FontFamily, Icon, NonIdealState, Spinner} from '@dagster-io/ui-components';
import {useCallback, useContext, useEffect, useMemo, useState} from 'react';

import {metadataForAssetNode} from './AssetMetadata';
import {CodeFileView} from './CodeFileView';
import {AppContext} from '../app/AppContext';
import {MetadataEntryFragment} from '../metadata/types/MetadataEntryFragment.types';

interface ScheduleInfo {
  jobName: string;
  description: string | null;
  cron: string | null;
  cronType: string | null;
  timezone: string | null;
  pauseStatus: string | null;
  pipeline: string | null;
}

interface BuildRun {
  id: string;
  type: 'snapshot' | 'update';
  fullRefresh: boolean;
  state: string | null;
  startedAt: number | null;
  durationMs: number | null;
}

interface CheckRow {
  name: string;
  condition: string;
  action: string;
}

interface SourcePayload {
  path: string;
  url: string;
  language: string;
  lineNumber: number | null;
  code: string;
  schedule: ScheduleInfo | null;
  checks: CheckRow[];
}

type RailTabId = 'code' | 'schedule' | 'builds' | 'checks';

interface Props {
  assetNode: Parameters<typeof metadataForAssetNode>[0];
}

const textValue = (entries: MetadataEntryFragment[], label: string): string | null => {
  const entry = entries.find((e) => e.label === label && e.__typename === 'TextMetadataEntry');
  return entry && entry.__typename === 'TextMetadataEntry' ? entry.text : null;
};

const urlValue = (entries: MetadataEntryFragment[], label: string): string | null => {
  const entry = entries.find((e) => e.label === label && e.__typename === 'UrlMetadataEntry');
  return entry && entry.__typename === 'UrlMetadataEntry' ? entry.url : null;
};

export const AssetCodeScheduleRail = ({assetNode}: Props) => {
  const {basePath} = useContext(AppContext);
  const {assetMetadata} = metadataForAssetNode(assetNode);

  const codeRefUrl = useMemo(() => {
    const entry = assetMetadata.find((e) => e.__typename === 'CodeReferencesMetadataEntry');
    const ref =
      entry && entry.__typename === 'CodeReferencesMetadataEntry'
        ? entry.codeReferences.find((r) => r.__typename === 'UrlCodeReference')
        : undefined;
    return ref && ref.__typename === 'UrlCodeReference' ? ref.url : null;
  }, [assetMetadata]);

  const facts = useMemo(
    () => ({
      catalog: textValue(assetMetadata, 'catalog'),
      schema: textValue(assetMetadata, 'schema'),
      table: textValue(assetMetadata, 'table'),
      materializedBy: textValue(assetMetadata, 'materialized_by'),
      databricksUrl: urlValue(assetMetadata, 'databricks_url'),
    }),
    [assetMetadata],
  );

  const [tab, setTab] = useState<RailTabId>('code');
  const [source, setSource] = useState<SourcePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (url: string, signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      setSource(null);
      try {
        const response = await fetch(`${basePath}/asset_source?url=${encodeURIComponent(url)}`, {
          signal,
        });
        const json = await response.json();
        if (!response.ok) {
          setError(json?.error || `Failed to load source (HTTP ${response.status}).`);
        } else {
          setSource(json as SourcePayload);
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError(e instanceof Error ? e.message : 'Source request failed.');
        }
      } finally {
        setLoading(false);
      }
    },
    [basePath],
  );

  useEffect(() => {
    if (!codeRefUrl) {
      setSource(null);
      return;
    }
    const controller = new AbortController();
    load(codeRefUrl, controller.signal);
    return () => controller.abort();
  }, [codeRefUrl, load]);

  // Build history is a live Databricks call, so fetch it lazily the first time
  // the Builds tab is opened for a given asset.
  const [builds, setBuilds] = useState<BuildRun[] | null>(null);
  const [buildsError, setBuildsError] = useState<string | null>(null);
  const [buildsLoading, setBuildsLoading] = useState(false);
  const [buildsUrl, setBuildsUrl] = useState<string | null>(null);

  useEffect(() => {
    setBuilds(null);
    setBuildsUrl(null);
    setBuildsError(null);
  }, [codeRefUrl]);

  useEffect(() => {
    if (tab !== 'builds' || !codeRefUrl || buildsUrl === codeRefUrl) {
      return;
    }
    const controller = new AbortController();
    (async () => {
      setBuildsLoading(true);
      setBuildsError(null);
      try {
        const response = await fetch(
          `${basePath}/asset_builds?url=${encodeURIComponent(codeRefUrl)}`,
          {signal: controller.signal},
        );
        const json = await response.json();
        if (!response.ok) {
          setBuildsError(json?.error || `Failed to load builds (HTTP ${response.status}).`);
        } else {
          setBuilds(json.builds || []);
          setBuildsUrl(codeRefUrl);
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setBuildsError(e instanceof Error ? e.message : 'Builds request failed.');
        }
      } finally {
        setBuildsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [tab, codeRefUrl, buildsUrl, basePath]);

  const schedule = source?.schedule ?? null;

  return (
    <Box flex={{direction: 'column'}} style={{height: '100%', minHeight: 0}}>
      <Box border="bottom" flex={{direction: 'row'}} padding={{horizontal: 16}}>
        <RailTab label="Code" active={tab === 'code'} onClick={() => setTab('code')} />
        <RailTab label="Schedule" active={tab === 'schedule'} onClick={() => setTab('schedule')} />
        <RailTab
          label="Builds"
          count={builds?.length}
          active={tab === 'builds'}
          onClick={() => setTab('builds')}
        />
        <RailTab
          label="Checks"
          count={source?.checks.length}
          active={tab === 'checks'}
          onClick={() => setTab('checks')}
        />
      </Box>

      <Box style={{flex: 1, minHeight: 0, overflow: 'hidden'}}>
        {!codeRefUrl ? (
          <Box padding={48} flex={{justifyContent: 'center'}} style={{height: '100%'}}>
            <NonIdealState
              icon="code_block"
              title="No source"
              description="This asset has no linked source file."
            />
          </Box>
        ) : loading && !source ? (
          <Box flex={{alignItems: 'center', justifyContent: 'center'}} style={{height: '100%'}}>
            <Spinner purpose="page" />
          </Box>
        ) : error ? (
          <Box padding={32} flex={{justifyContent: 'center'}} style={{height: '100%'}}>
            <NonIdealState icon="error" title="Couldn't load source" description={error} />
          </Box>
        ) : source && tab === 'code' ? (
          <CodeFileView
            code={source.code}
            language={source.language}
            fileName={source.path}
            highlightLine={source.lineNumber}
            actions={
              <a href={source.url} target="_blank" rel="noreferrer">
                <Box flex={{direction: 'row', alignItems: 'center', gap: 4}}>
                  Open in repo <Icon name="open_in_new" />
                </Box>
              </a>
            }
          />
        ) : source && tab === 'schedule' ? (
          <SchedulePanel schedule={schedule} facts={facts} sourcePath={source.path} />
        ) : tab === 'builds' ? (
          buildsLoading && !builds ? (
            <Box flex={{alignItems: 'center', justifyContent: 'center'}} style={{height: '100%'}}>
              <Spinner purpose="page" />
            </Box>
          ) : buildsError ? (
            <Box padding={32} flex={{justifyContent: 'center'}} style={{height: '100%'}}>
              <NonIdealState icon="error" title="Couldn't load builds" description={buildsError} />
            </Box>
          ) : (
            <BuildsPanel builds={builds ?? []} pipeline={schedule?.pipeline ?? null} />
          )
        ) : source ? (
          <ChecksPanel checks={source.checks} />
        ) : null}
      </Box>
    </Box>
  );
};

const RailTab = ({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    style={{
      appearance: 'none',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '12px 4px',
      marginRight: 20,
      fontSize: 13,
      fontWeight: 600,
      color: active ? Colors.textDefault() : Colors.textLight(),
      borderBottom: `2px solid ${active ? Colors.textDefault() : 'transparent'}`,
    }}
  >
    {label}
    {count ? (
      <span
        style={{
          marginLeft: 6,
          fontFamily: FontFamily.monospace,
          fontSize: 10,
          color: Colors.textLight(),
        }}
      >
        {count}
      </span>
    ) : null}
  </button>
);

const EmptyPanel = ({
  icon,
  title,
  description,
}: {
  icon: 'history' | 'assignment_turned_in';
  title: string;
  description: string;
}) => (
  <Box padding={48} flex={{justifyContent: 'center'}} style={{height: '100%'}}>
    <NonIdealState icon={icon} title={title} description={description} />
  </Box>
);

const formatDuration = (ms: number | null): string => {
  if (!ms || ms < 0) {
    return '—';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const formatStarted = (ms: number | null): string => {
  if (!ms) {
    return '';
  }
  const date = new Date(ms);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const buildStateColor = (state: string | null): {bg: string; text: string} => {
  if (state === 'COMPLETED') {
    return {bg: Colors.backgroundGreen(), text: Colors.textGreen()};
  }
  if (state === 'FAILED') {
    return {bg: Colors.backgroundRed(), text: Colors.textRed()};
  }
  return {bg: Colors.backgroundGray(), text: Colors.textLight()};
};

const BuildsPanel = ({builds, pipeline}: {builds: BuildRun[]; pipeline: string | null}) => {
  if (!builds.length) {
    return (
      <EmptyPanel
        icon="history"
        title="No build history"
        description="No Lakeflow pipeline runs found for this asset."
      />
    );
  }
  return (
    <Box style={{height: '100%', overflow: 'auto'}} flex={{direction: 'column'}}>
      {pipeline ? (
        <Box
          padding={{vertical: 8, horizontal: 20}}
          border="bottom"
          background={Colors.backgroundLight()}
          flex={{direction: 'row', alignItems: 'center', gap: 8}}
        >
          <Icon name="schedule" color={Colors.textLight()} />
          <span
            style={{fontFamily: FontFamily.monospace, fontSize: 11.5, color: Colors.textLight()}}
          >
            {pipeline} pipeline
          </span>
        </Box>
      ) : null}
      {builds.map((build) => {
        const stateColor = buildStateColor(build.state);
        return (
          <Box
            key={build.id}
            padding={{vertical: 12, horizontal: 20}}
            border="bottom"
            flex={{direction: 'column', gap: 6}}
          >
            <Box
              flex={{
                direction: 'row',
                alignItems: 'center',
                gap: 8,
                justifyContent: 'space-between',
              }}
            >
              <Box flex={{direction: 'row', alignItems: 'center', gap: 8}}>
                <span
                  style={{
                    fontFamily: FontFamily.monospace,
                    fontSize: 9.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: build.fullRefresh
                      ? Colors.backgroundBlue()
                      : Colors.backgroundGray(),
                    color: build.fullRefresh ? Colors.textBlue() : Colors.textLight(),
                  }}
                >
                  {build.type}
                </span>
                <span
                  style={{
                    fontFamily: FontFamily.monospace,
                    fontSize: 11,
                    color: Colors.textLight(),
                  }}
                >
                  {build.id}
                </span>
              </Box>
              <span
                style={{
                  fontFamily: FontFamily.monospace,
                  fontSize: 9.5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: stateColor.bg,
                  color: stateColor.text,
                }}
              >
                {build.state ?? 'unknown'}
              </span>
            </Box>
            <Box flex={{direction: 'row', alignItems: 'center', gap: 8}}>
              <Icon name="timer" color={Colors.textLight()} />
              <span style={{fontFamily: FontFamily.monospace, fontSize: 11.5}}>
                {formatDuration(build.durationMs)}
              </span>
              <span style={{fontSize: 11.5, color: Colors.textLight()}}>
                · {formatStarted(build.startedAt)}
              </span>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

const checkActionColor = (action: string): {bg: string; text: string} => {
  if (action === 'fail') {
    return {bg: Colors.backgroundRed(), text: Colors.textRed()};
  }
  if (action === 'drop') {
    return {bg: Colors.backgroundYellow(), text: Colors.textYellow()};
  }
  return {bg: Colors.backgroundGray(), text: Colors.textLight()};
};

const ChecksPanel = ({checks}: {checks: CheckRow[]}) => {
  if (!checks.length) {
    return (
      <EmptyPanel
        icon="assignment_turned_in"
        title="No checks defined"
        description="This asset declares no data-quality expectations."
      />
    );
  }
  return (
    <Box style={{height: '100%', overflow: 'auto'}} flex={{direction: 'column'}}>
      {checks.map((check) => {
        const color = checkActionColor(check.action);
        return (
          <Box
            key={check.name}
            padding={{vertical: 12, horizontal: 20}}
            border="bottom"
            flex={{direction: 'column', gap: 6}}
          >
            <Box
              flex={{
                direction: 'row',
                alignItems: 'center',
                gap: 8,
                justifyContent: 'space-between',
              }}
            >
              <span style={{fontFamily: FontFamily.monospace, fontSize: 12, fontWeight: 600}}>
                {check.name}
              </span>
              <span
                style={{
                  fontFamily: FontFamily.monospace,
                  fontSize: 9.5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: color.bg,
                  color: color.text,
                }}
              >
                {check.action}
              </span>
            </Box>
            <span
              style={{fontFamily: FontFamily.monospace, fontSize: 11.5, color: Colors.textLight()}}
            >
              {check.condition}
            </span>
          </Box>
        );
      })}
    </Box>
  );
};

const KeyValueRow = ({label, children}: {label: string; children: React.ReactNode}) => (
  <Box
    padding={{vertical: 12, horizontal: 20}}
    border="bottom"
    flex={{direction: 'row', alignItems: 'baseline', gap: 12, justifyContent: 'space-between'}}
  >
    <span
      style={{
        fontFamily: FontFamily.monospace,
        fontSize: 9.5,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: Colors.textLight(),
        flex: 'none',
      }}
    >
      {label}
    </span>
    <span style={{fontSize: 12.5, textAlign: 'right', minWidth: 0}}>{children}</span>
  </Box>
);

const SchedulePanel = ({
  schedule,
  facts,
  sourcePath,
}: {
  schedule: ScheduleInfo | null;
  facts: {
    catalog: string | null;
    schema: string | null;
    table: string | null;
    materializedBy: string | null;
    databricksUrl: string | null;
  };
  sourcePath: string;
}) => {
  const mono = {fontFamily: FontFamily.monospace};
  const fqTable =
    facts.catalog && facts.schema && facts.table
      ? `${facts.catalog}.${facts.schema}.${facts.table}`
      : null;

  return (
    <Box style={{height: '100%', overflow: 'auto'}} flex={{direction: 'column'}}>
      {/* Cron / trigger card */}
      <Box
        padding={20}
        border="bottom"
        background={Colors.backgroundLight()}
        flex={{direction: 'column', gap: 6}}
      >
        <Box flex={{direction: 'row', alignItems: 'center', gap: 8}}>
          <Icon name="schedule" />
          {schedule?.cron ? (
            <span style={{...mono, fontSize: 15, fontWeight: 600}}>{schedule.cron}</span>
          ) : (
            <span style={{fontSize: 14, fontWeight: 600}}>Lakeflow task job</span>
          )}
        </Box>
        <span style={{fontSize: 12.5, color: Colors.textLight()}}>
          {schedule?.cron
            ? `${schedule.cronType ?? 'cron'}${schedule.timezone ? ` · ${schedule.timezone}` : ''}`
            : 'Triggered as part of a multi-task Lakeflow job (no standalone cron).'}
        </span>
        {schedule?.description ? (
          <span style={{fontSize: 12.5, color: Colors.textLight()}}>{schedule.description}</span>
        ) : null}
      </Box>

      {schedule?.jobName ? (
        <KeyValueRow label="Trigger job">
          <span style={mono}>{schedule.jobName}</span>
        </KeyValueRow>
      ) : null}
      {schedule?.pauseStatus ? (
        <KeyValueRow label="Status">{schedule.pauseStatus}</KeyValueRow>
      ) : null}
      {facts.materializedBy ? (
        <KeyValueRow label="Materialized by">{facts.materializedBy}</KeyValueRow>
      ) : null}
      {fqTable ? (
        <KeyValueRow label="Table">
          <span style={mono}>{fqTable}</span>
        </KeyValueRow>
      ) : null}
      <KeyValueRow label="Source">
        <span style={mono}>{sourcePath}</span>
      </KeyValueRow>
      {facts.databricksUrl ? (
        <KeyValueRow label="Warehouse">
          <a href={facts.databricksUrl} target="_blank" rel="noreferrer">
            <Box
              flex={{direction: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end'}}
            >
              Open in Databricks <Icon name="open_in_new" />
            </Box>
          </a>
        </KeyValueRow>
      ) : null}
    </Box>
  );
};
