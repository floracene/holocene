import {Box, NonIdealState, Spinner} from '@dagster-io/ui-components';
import {useMemo} from 'react';

import {metadataForAssetNode} from './AssetMetadata';
import {CodeFileView} from './CodeFileView';
import {CodeLink, getCodeReferenceKey} from '../code-links/CodeLink';
import {MetadataEntryFragment} from '../metadata/types/MetadataEntryFragment.types';

type MarkdownEntry = Extract<MetadataEntryFragment, {__typename: 'MarkdownMetadataEntry'}>;
type CodeReferencesEntry = Extract<
  MetadataEntryFragment,
  {__typename: 'CodeReferencesMetadataEntry'}
>;

const EXT_BY_LANGUAGE: Record<string, string> = {python: 'py', sql: 'sql', scala: 'scala'};

// mdStr arrives fenced (```python\n...\n```); pull out the language + raw code.
const parseCodeBlock = (md: string): {language: string; code: string} => {
  const match = md.match(/^```([\w+-]*)\n([\s\S]*?)\n?```\s*$/);
  if (match) {
    return {language: match[1] || '', code: match[2] ?? ''};
  }
  return {language: '', code: md.trim()};
};

const fileNameFromRefs = (
  refs: CodeReferencesEntry['codeReferences'],
  language: string,
): string => {
  for (const ref of refs) {
    if (ref.__typename === 'UrlCodeReference') {
      const withoutAnchor = ref.url.split('#')[0] ?? ref.url;
      const base = withoutAnchor.substring(withoutAnchor.lastIndexOf('/') + 1);
      if (base) {
        return base;
      }
    }
  }
  const ext = EXT_BY_LANGUAGE[language];
  return ext ? `source.${ext}` : 'source';
};

// Whether the asset carries any code worth showing in a code rail.
export const assetHasSourceCode = (
  assetNode: Parameters<typeof metadataForAssetNode>[0],
): boolean => {
  const {assetMetadata} = metadataForAssetNode(assetNode);
  return assetMetadata.some(
    (entry) =>
      (entry.__typename === 'MarkdownMetadataEntry' &&
        (entry.label === 'source' || entry.label === 'table_ddl')) ||
      entry.__typename === 'CodeReferencesMetadataEntry',
  );
};

interface Props {
  assetNode: Parameters<typeof metadataForAssetNode>[0];
  loading?: boolean;
}

export const AssetCodeView = ({assetNode, loading}: Props) => {
  const {assetMetadata} = metadataForAssetNode(assetNode);

  const sourceEntry = assetMetadata.find(
    (entry): entry is MarkdownEntry =>
      entry.__typename === 'MarkdownMetadataEntry' && entry.label === 'source',
  );
  const ddlEntry = assetMetadata.find(
    (entry): entry is MarkdownEntry =>
      entry.__typename === 'MarkdownMetadataEntry' && entry.label === 'table_ddl',
  );
  const codeEntry = sourceEntry ?? ddlEntry;
  const codeReferences =
    assetMetadata.find(
      (entry): entry is CodeReferencesEntry => entry.__typename === 'CodeReferencesMetadataEntry',
    )?.codeReferences ?? [];

  const parsed = useMemo(() => (codeEntry ? parseCodeBlock(codeEntry.mdStr) : null), [codeEntry]);

  if (loading && !codeEntry) {
    return (
      <Box style={{flex: 1}} flex={{alignItems: 'center', justifyContent: 'center'}}>
        <Spinner purpose="page" />
      </Box>
    );
  }

  if (!codeEntry || !parsed) {
    return (
      <Box padding={48} flex={{justifyContent: 'center'}} style={{flex: 1}}>
        <NonIdealState
          icon="code_block"
          title="No source"
          description="This asset has no attached source code."
        />
      </Box>
    );
  }

  return (
    <CodeFileView
      code={parsed.code}
      language={parsed.language}
      fileName={fileNameFromRefs(codeReferences, parsed.language)}
      actions={codeReferences.map((ref) => (
        <CodeLink key={getCodeReferenceKey(ref)} sourceLocation={ref} />
      ))}
    />
  );
};
