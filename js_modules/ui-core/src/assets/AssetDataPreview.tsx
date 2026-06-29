import {Box} from '@dagster-io/ui-components';

import {AssetCodeView, assetHasSourceCode} from './AssetCodeView';
import {AssetDataTable} from './AssetDataTable';
import {metadataForAssetNode} from './AssetMetadata';

interface Props {
  // The asset key path; for Unity Catalog assets this is [catalog, schema, table].
  assetKey: {path: string[]};
  // The loaded asset node, used to surface the authoring code beside the data.
  assetNode: Parameters<typeof metadataForAssetNode>[0];
}

export const AssetDataPreview = ({assetKey, assetNode}: Props) => {
  const hasCode = assetHasSourceCode(assetNode);

  return (
    <Box flex={{direction: 'row'}} style={{height: '100%', overflow: 'hidden'}}>
      <AssetDataTable assetKey={assetKey} />
      {hasCode ? (
        <Box border="left" style={{width: 440, flex: 'none', minHeight: 0}}>
          <AssetCodeView assetNode={assetNode} />
        </Box>
      ) : null}
    </Box>
  );
};
