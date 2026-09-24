(() => {
  if (window.__T) { console.warn("[T] already armed — call __T.clear() to reset"); return; }
  const L = [];
  const t0 = Date.now();
  const p = (m, d) => {
    const e = {
      dt: Date.now() - t0,
      m,
      d,
      s: (new Error()).stack.split("\n").slice(2, 9).join(" | "),
    };
    L.push(e);
    console.log("[T+" + e.dt + "ms]", m, d);
  };

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () {
    p("history.pushState", { url: arguments[2] });
    return origPush.apply(this, arguments);
  };
  history.replaceState = function () {
    p("history.replaceState", { url: arguments[2] });
    return origReplace.apply(this, arguments);
  };

  addEventListener("popstate", () => p("popstate", { url: location.search }), true);

  const origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && typeof ev.type === "string" && ev.type.indexOf("hf:") === 0) {
      p("dispatchEvent " + ev.type, ev.detail);
    }
    return origDispatch.call(this, ev);
  };

  addEventListener("click", (e) => {
    let n = e.target;
    const path = [];
    while (n && path.length < 5) {
      const tid = n.dataset && n.dataset.testid ? "[" + n.dataset.testid + "]" : "";
      path.push((n.tagName || "") + tid);
      n = n.parentElement;
    }
    p("click", {
      path: path.join(" > "),
      text: (e.target.textContent || "").trim().slice(0, 60),
    });
  }, true);

  const attachObs = () => {
    const btn = document.querySelector('button[draggable="true"]');
    const strip = btn ? btn.parentElement : null;
    if (!strip) {
      setTimeout(attachObs, 500);
      return;
    }
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === "attributes") {
          p("tab DOM mut", {
            tab: (m.target.textContent || "").trim().slice(0, 40),
            border: m.target.style && m.target.style.borderBottom,
          });
        }
      }
    }).observe(strip, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "aria-selected"],
    });
    p("observer attached", { tabs: strip.children.length });
  };
  attachObs();

  window.__T = {
    L,
    c: () => navigator.clipboard.writeText("```\n" + JSON.stringify(L, null, 2) + "\n```")
      .then(() => console.log("[T] copied", L.length, "entries to clipboard — paste back to Claude")),
    clear: () => { L.length = 0; console.log("[T] cleared"); },
  };

  console.log("%c[T] armed — reproduce the bug, then run __T.c()",
    "background:#1F1B4A;color:#F5B856;padding:6px 10px;border-radius:4px;font-weight:bold;");
})();
