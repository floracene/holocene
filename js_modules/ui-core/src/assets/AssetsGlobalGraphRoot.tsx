import {Box, NonIdealState, Page, Spinner, SplitPanelContainer} from '@dagster-io/ui-components';
import {AssetsGraphHeader} from '@shared/assets/AssetsGraphHeader';
import {useFavoriteAssets} from '@shared/assets/useFavoriteAssets';
import {useCallback, useMemo} from 'react';
import {useHistory, useParams} from 'react-router-dom';

import {AssetCodeScheduleRail} from './AssetCodeScheduleRail';
import {AssetDataTable} from './AssetDataTable';
import {assetDetailsPathForKey} from './assetDetailsPathForKey';
import {
  globalAssetGraphPathFromString,
  globalAssetGraphPathToString,
} from './globalAssetGraphPathToString';
import {useAssetDefinition} from './useAssetDefinition';
import {useTrackPageView} from '../app/analytics';
import {AssetGraphExplorer} from '../asset-graph/AssetGraphExplorer';
import {AssetGraphViewType, tokenForAssetKey, tokenToAssetKey} from '../asset-graph/Utils';
import {AssetGraphFetchScope} from '../asset-graph/useAssetGraphData';
import {AssetLocation} from '../asset-graph/useFindAssetLocation';
import {useDocumentTitle} from '../hooks/useDocumentTitle';
import {useOpenInNewTab} from '../hooks/useOpenInNewTab';
import {useStateWithStorage} from '../hooks/useStateWithStorage';
import {ExplorerPath} from '../pipelines/PipelinePathUtils';

interface AssetGroupRootParams {
  0: string;
}

const EMPTY_ASSET_KEY = {path: [] as string[]};

export const AssetsGlobalGraphRoot = () => {
  useTrackPageView();
  const {0: path} = useParams<AssetGroupRootParams>();
  const history = useHistory();

  useDocumentTitle('Global asset lineage');
  const openInNewTab = useOpenInNewTab();

  const onChangeExplorerPath = useCallback(
    (path: ExplorerPath, mode: 'push' | 'replace') => {
      history[mode]({
        pathname: globalAssetGraphPathToString(path),
        search: history.location.search,
      });
    },
    [history],
  );

  const onNavigateToSourceAssetNode = useCallback(
    (e: Pick<React.MouseEvent<any>, 'metaKey'>, node: AssetLocation) => {
      const path = assetDetailsPathForKey(node.assetKey, {view: 'definition'});
      if (e.metaKey) {
        openInNewTab(path);
      } else {
        history.push(path);
      }
    },
    [history, openInNewTab],
  );

  const [hideEdgesToNodesOutsideQuery, setHideEdgesToNodesOutsideQuery] = useStateWithStorage(
    'hideEdgesToNodesOutsideQuery',
    (json) => {
      if (json === 'false' || json === false) {
        return false;
      }
      return true;
    },
  );

  const {favorites, loading: favoritesLoading} = useFavoriteAssets();

  const fetchOptions = useMemo(() => {
    const options: AssetGraphFetchScope = {
      hideEdgesToNodesOutsideQuery,
      hideNodesMatching: favorites
        ? (node) => !favorites.has(tokenForAssetKey(node.assetKey))
        : undefined,
      loading: favoritesLoading,
    };
    return options;
  }, [hideEdgesToNodesOutsideQuery, favorites, favoritesLoading]);

  // Node selection is encoded in the URL (explorerPath.opNames). When exactly one
  // asset is selected we dock its live data below the graph and its source + schedule
  // in the right rail — clicking a node updates the URL, which re-derives selection.
  const explorerPath = useMemo(() => globalAssetGraphPathFromString(path), [path]);
  const selectedKey = useMemo(() => {
    const last = explorerPath.opNames[explorerPath.opNames.length - 1] ?? '';
    const tokens = last.split(',').filter((token) => token && token !== '*');
    const [token] = tokens;
    return tokens.length === 1 && token ? tokenToAssetKey(token) : null;
  }, [explorerPath]);

  const {definition, definitionQueryResult} = useAssetDefinition(selectedKey ?? EMPTY_ASSET_KEY);

  const noSelection = (icon: 'table_view' | 'code_block', noun: string) => (
    <Box
      padding={32}
      flex={{justifyContent: 'center', alignItems: 'center'}}
      style={{height: '100%'}}
    >
      <NonIdealState
        icon={icon}
        title="No asset selected"
        description={`Click an asset in the graph to see its ${noun}.`}
      />
    </Box>
  );

  const railLoading = !!selectedKey && definitionQueryResult.loading && !definition;

  return (
    <Page style={{display: 'flex', flexDirection: 'column', paddingBottom: 0}}>
      <AssetsGraphHeader />

      {/* Graph + live-data dock on the left; the asset's source + schedule on the
          right. The explorer's built-in right panel is suppressed so this rail
          owns the right column. All panels are resizable via SplitPanelContainer. */}
      <Box flex={{direction: 'column'}} style={{flex: 1, minHeight: 0}}>
        <SplitPanelContainer
          axis="horizontal"
          identifier="global-lineage-rail"
          firstInitialPercent={70}
          firstMinSize={480}
          secondMinSize={360}
          first={
            <SplitPanelContainer
              axis="vertical"
              identifier="global-lineage-data"
              firstInitialPercent={62}
              firstMinSize={200}
              secondMinSize={160}
              first={
                <AssetGraphExplorer
                  fetchOptions={fetchOptions}
                  options={{preferAssetRendering: true, explodeComposites: true}}
                  explorerPath={explorerPath}
                  onChangeExplorerPath={onChangeExplorerPath}
                  onNavigateToSourceAssetNode={onNavigateToSourceAssetNode}
                  viewType={AssetGraphViewType.GLOBAL}
                  setHideEdgesToNodesOutsideQuery={setHideEdgesToNodesOutsideQuery}
                  hideRightInfoPanel
                />
              }
              second={
                selectedKey ? (
                  <AssetDataTable assetKey={selectedKey} />
                ) : (
                  noSelection('table_view', 'data')
                )
              }
            />
          }
          second={
            !selectedKey ? (
              noSelection('code_block', 'code and schedule')
            ) : railLoading ? (
              <Box flex={{alignItems: 'center', justifyContent: 'center'}} style={{height: '100%'}}>
                <Spinner purpose="page" />
              </Box>
            ) : (
              <AssetCodeScheduleRail assetNode={definition} />
            )
          }
        />
      </Box>
    </Page>
  );
};

// Imported via React.lazy, which requires a default export.
// eslint-disable-next-line import/no-default-export
export default AssetsGlobalGraphRoot;
