import { useState, useEffect, useRef, useMemo } from 'react';

function SimpleMarkdown({ text }) {
  if (!text) return null;
  const paras = text.split(/\n\n+/);
  return (
    <div className="question-description">
      {paras.map((para, i) => (
        <p key={i}>
          {para.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((chunk, j) => {
            if (/^\*\*(.+)\*\*$/.test(chunk))
              return <strong key={j}>{chunk.slice(2, -2)}</strong>;
            if (/^\*(.+)\*$/.test(chunk))
              return <em key={j}>{chunk.slice(1, -1)}</em>;
            return chunk;
          })}
        </p>
      ))}
    </div>
  );
}

function sample(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function getDefaultUsername() {
  const username = new URLSearchParams(window.location.search).get('username') || '';
  return username.trim().slice(0, 50);
}

export default function LoginModal({ config, images = [], onLogin }) {
  const [value, setValue] = useState(getDefaultUsername);
  const [readOnly, setReadOnly] = useState(true);
  const inputRef = useRef(null);

  const { col1, col2, col3, col4, col5 } = useMemo(() => {
    const shuffled = sample(images, images.length);
    const c1 = [], c2 = [], c3 = [], c4 = [], c5 = [];
    const cols = [c1, c2, c3, c4, c5];
    shuffled.forEach((img, i) => cols[i % 5].push(img));
    return { col1: c1, col2: c2, col3: c3, col4: c4, col5: c5 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    const name = value.trim();
    if (!name) return;
    onLogin(name);
  }

  return (
    <div className="intro-screen">
      {images.length > 0 && (
        <div className="intro-bg-masonry" aria-hidden="true">
          {[col1, col2, col3, col4, col5].map((col, ci) => (
            <div key={ci} className="intro-bg-col">
              {col.map((img) => (
                <div key={img._id} className="intro-bg-cell">
                  <img
                    src={`/previews/${img.filename.replace(/\.[^.]+$/, '.jpg')}`}
                    onError={(e) => { e.currentTarget.src = `/images/${img.filename}`; }}
                    alt=""
                    draggable={false}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="intro-scrim" />

      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-question">
        <p className="modal-app-title">{config.appTitle}</p>
        <h1 className="modal-question-heading" id="modal-question">
          {config.question}
        </h1>
        <SimpleMarkdown text={config.questionDescription} />

        <form onSubmit={handleSubmit}>
          <label className="modal-label" htmlFor="username-input">
            Your name
          </label>
          <input
            ref={inputRef}
            id="username-input"
            className="modal-input"
            type="text"
            placeholder="Enter your name to begin"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setReadOnly(false)}
            maxLength={50}
            readOnly={readOnly}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
          />
          <button className="modal-btn" type="submit">
            Start comparing
          </button>
        </form>

        <div className="modal-instructions">
          <ul>
            <li>Two images appear side by side — click the one that best fits the question.</li>
            <li>
              You have {(config.timePerComparison / 1000).toFixed(0)} seconds per
              pair. If time runs out, the pair is skipped automatically.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}


