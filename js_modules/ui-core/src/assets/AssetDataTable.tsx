import {
  Box,
  Button,
  Colors,
  FontFamily,
  Icon,
  NonIdealState,
  Spinner,
} from '@dagster-io/ui-components';
import clsx from 'clsx';
import {useCallback, useContext, useEffect, useMemo, useState} from 'react';

import styles from './css/AssetDataPreview.module.css';
import {AppContext} from '../app/AppContext';

const PREVIEW_ROW_LIMIT = 100;

// Column types that are right-aligned and rendered as numerics, matching the
// "machine truth" treatment in the design (prices, counts, ids-as-numbers).
const NUMERIC_TYPE =
  /^(INT|INTEGER|BIGINT|SMALLINT|TINYINT|LONG|SHORT|BYTE|DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC)/i;

interface PreviewColumn {
  name: string;
  type: string | null;
}

interface PreviewPayload {
  table: string;
  query: string;
  columns: PreviewColumn[];
  rows: Array<Array<string | null>>;
  rowCount: number;
  limit: number;
  truncated: boolean;
  cached: boolean;
}

interface Props {
  // The asset key path; for Unity Catalog assets this is [catalog, schema, table].
  assetKey: {path: string[]};
}

export const AssetDataTable = ({assetKey}: Props) => {
  const {basePath} = useContext(AppContext);

  // For Unity Catalog tables the asset key path *is* the fully-qualified name.
  const table = useMemo(() => assetKey.path.join('.'), [assetKey.path]);
  const isUnityCatalogTable = assetKey.path.length === 3;

  const [data, setData] = useState<PreviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const url = `${basePath}/preview?table=${encodeURIComponent(table)}&n=${PREVIEW_ROW_LIMIT}`;
        const response = await fetch(url, {signal});
        const json = await response.json();
        if (!response.ok) {
          setError(json?.error || `Preview failed (HTTP ${response.status}).`);
          setData(null);
        } else {
          setData(json as PreviewPayload);
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError(e instanceof Error ? e.message : 'Preview request failed.');
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [basePath, table],
  );

  useEffect(() => {
    if (!isUnityCatalogTable) {
      return;
    }
    setData(null);
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [isUnityCatalogTable, load]);

  if (!isUnityCatalogTable) {
    return (
      <Box padding={48} flex={{justifyContent: 'center'}} style={{flex: 1}}>
        <NonIdealState
          icon="table_view"
          title="No live preview"
          description="Live preview is available for Unity Catalog tables (catalog.schema.table)."
        />
      </Box>
    );
  }

  return (
    <Box
      flex={{direction: 'column'}}
      style={{flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden'}}
    >
      <Box
        padding={{vertical: 12, horizontal: 16}}
        border="bottom"
        flex={{direction: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12}}
      >
        <Box flex={{direction: 'row', alignItems: 'center', gap: 8}} style={{minWidth: 0}}>
          <Icon name="table_view" />
          <span style={{fontFamily: FontFamily.monospace, fontWeight: 600}}>{table}</span>
          {data ? (
            <span style={{color: Colors.textLight()}}>
              first {data.rowCount} row{data.rowCount === 1 ? '' : 's'}
              {data.truncated ? ` · LIMIT ${data.limit}` : ''}
              {data.cached ? ' · cached' : ''}
            </span>
          ) : null}
        </Box>
        <Button icon={<Icon name="refresh" />} onClick={() => load()} disabled={loading}>
          Refresh
        </Button>
      </Box>

      <Box style={{flex: 1, minHeight: 0, overflow: 'auto', position: 'relative'}}>
        {loading && !data ? (
          <Box padding={48} flex={{justifyContent: 'center'}}>
            <Spinner purpose="page" />
          </Box>
        ) : error ? (
          <Box padding={24} flex={{direction: 'column', gap: 12, alignItems: 'flex-start'}}>
            <NonIdealState icon="error" title="Couldn't load preview" description={error} />
          </Box>
        ) : data && data.columns.length ? (
          <table className={styles.previewTable}>
            <thead>
              <tr>
                {data.columns.map((col) => (
                  <th
                    key={col.name}
                    className={clsx(NUMERIC_TYPE.test(col.type || '') && styles.numeric)}
                  >
                    <div className={styles.colName}>{col.name}</div>
                    {col.type ? <div className={styles.colType}>{col.type}</div> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {data.columns.map((col, colIdx) => {
                    const value = row[colIdx];
                    const numeric = NUMERIC_TYPE.test(col.type || '');
                    return (
                      <td key={col.name} className={clsx(numeric && styles.numeric)}>
                        {value === null || value === undefined ? (
                          <span className={styles.null}>NULL</span>
                        ) : (
                          value
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Box padding={48} flex={{justifyContent: 'center'}}>
            <NonIdealState
              icon="search"
              title="No rows"
              description="This table returned no rows."
            />
          </Box>
        )}
      </Box>

      {data ? (
        <Box
          padding={{vertical: 8, horizontal: 16}}
          border="top"
          background={Colors.backgroundLight()}
          flex={{direction: 'row', alignItems: 'center', gap: 8}}
          style={{fontFamily: FontFamily.monospace, fontSize: 11.5, color: Colors.textLight()}}
        >
          <Icon name="console" color={Colors.textLight()} />
          <span>{data.query}</span>
        </Box>
      ) : null}
    </Box>
  );
};
