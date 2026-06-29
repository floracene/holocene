import {Icon} from '@dagster-io/ui-components';
import hljs from 'highlight.js';
import {ReactNode, useEffect, useMemo, useRef} from 'react';

import 'highlight.js/styles/github.css';
import styles from './css/AssetCodeView.module.css';

// Keep in sync with the font-size / line-height in AssetCodeView.module.css.
const LINE_HEIGHT_PX = 11.5 * 1.6;

interface Props {
  code: string;
  language: string;
  fileName: string;
  // Rendered on the right of the file header (e.g. an "Open in repo" link).
  actions?: ReactNode;
  // 1-based line to scroll into view when the file loads.
  highlightLine?: number | null;
}

export const CodeFileView = ({code, language, fileName, actions, highlightLine}: Props) => {
  const bodyRef = useRef<HTMLDivElement>(null);

  const {html, lineCount} = useMemo(() => {
    let value: string | null;
    try {
      value =
        language && hljs.getLanguage(language)
          ? hljs.highlight(code, {language}).value
          : hljs.highlightAuto(code).value;
    } catch {
      value = null;
    }
    return {html: value, lineCount: code.split('\n').length};
  }, [code, language]);

  useEffect(() => {
    if (highlightLine && bodyRef.current) {
      bodyRef.current.scrollTop = Math.max(0, (highlightLine - 3) * LINE_HEIGHT_PX);
    }
  }, [highlightLine, html]);

  const gutter = Array.from({length: lineCount}, (_, i) => i + 1).join('\n');

  return (
    <div className={styles.codeFile}>
      <div className={styles.header}>
        <Icon name="code_block" />
        <span className={styles.fileName}>{fileName}</span>
        <div style={{flex: 1}} />
        {actions}
      </div>
      <div className={styles.body} ref={bodyRef}>
        <pre className={styles.gutter} aria-hidden="true">
          {gutter}
        </pre>
        <pre className={styles.code}>
          {html !== null ? (
            // hljs escapes the code content, so this HTML is safe from injection.
            <code className="hljs" dangerouslySetInnerHTML={{__html: html}} />
          ) : (
            <code>{code}</code>
          )}
        </pre>
      </div>
    </div>
  );
};
