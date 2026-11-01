/* Private RAG assistant: load the full demo (rag/) into the playground on request,
   so its ~4 MB of index data is only fetched by visitors who actually start it. */
(function ragEmbed() {
  const host = document.getElementById('ragEmbed');
  const btn = document.getElementById('ragStart');
  if (!host || !btn) return;
  btn.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = 'rag/?embed=1';
    f.title = 'Private RAG assistant, live demo';
    f.setAttribute('allow', 'fullscreen');
    host.replaceChildren(f);
    f.focus();
  });
})();
