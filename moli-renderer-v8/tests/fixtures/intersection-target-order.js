(() => {
  const order = [8, 3, 10, 0, 9, 2, 11, 1, 6, 4, 7, 5];
  const cases = [
    ['duplicate observe and DOM reordering preserve observation order', '8,3,10,0,9,2,11,1,6,4,7,5'],
    ['unobserve preserves survivors and re-observe appends targets', '8,10,0,9,2,11,1,4,7,5,3,6'],
    ['disconnect clears the prior order before re-observation', '6,8,0'],
  ];
  globalThis.__intersectionQueues = {
    result: null,
    expected: null,
    start(index) {
      document.body.replaceChildren();
      this.result = null;
      this.expected = cases[index][1];
      const targets = Array.from({length: 12}, (_, index) => {
        const target = document.body.appendChild(document.createElement('div'));
        target.id = String(index);
        target.style.cssText = 'width:20px;height:20px';
        return target;
      });
      const observer = new IntersectionObserver(entries => {
        const batch = entries.map(entry => entry.target.id).join(',');
        this.result = this.result === null ? batch : this.result + '|' + batch;
        observer.disconnect();
      });
      order.forEach(index => observer.observe(targets[index]));
      observer.observe(targets[3]);
      if (index === 1) {
        observer.unobserve(targets[3]);
        observer.unobserve(targets[6]);
        observer.observe(targets[3]);
        observer.observe(targets[6]);
      } else if (index === 2) {
        observer.disconnect();
        [6, 8, 0].forEach(index => observer.observe(targets[index]));
      }
      document.body.prepend(targets[5]);
      return cases[index][0];
    },
  };
  return cases.length;
})();
