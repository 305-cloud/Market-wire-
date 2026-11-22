(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const sessionKey = 'market-wire-session-v1';
  const credits = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  const sellerQuotes = {
    ellis: '4200 Cedar Lane',
    jules: '3900 Oak Row',
    rowan: '4800 North Arcade',
  };
  let session;
  let snapshot;
  let busy = false;
  let poll;
  let actionSignature = '';
  let messageSignature = '';

  function storedSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey));
      if (typeof saved?.marketId === 'string' && typeof saved?.token === 'string') return saved;
    } catch {}
  }

  function remember(value) {
    session = value;
    try {
      if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
      else sessionStorage.removeItem(sessionKey);
    } catch {}
  }

  async function request(path, body, active = session) {
    const headers = {};
    if (active) headers.Authorization = 'Bearer ' + active.token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/demo/markets' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error ?? data.reason ?? 'request failed');
      error.status = response.status;
      error.retryAfter = Number(response.headers.get('retry-after'));
      throw error;
    }
    return data;
  }

  function status(message = '', success = false) {
    const bar = byId('statusBar');
    bar.className = success ? 'info' : '';
    bar.textContent = message;
  }

  function plainError(error) {
    if (error.status === 429) {
      return error.retryAfter > 0
        ? 'The demo is busy. Try again in about ' + Math.ceil(error.retryAfter / 60) + ' min.'
        : 'The demo is busy. Try again shortly.';
    }
    const messages = {
      'no held request': 'Hold an offer before confirming pickup.',
      'no wideneable request': 'Open a shortage before asking the coordinator.',
      not_member: 'This action isn’t available to the selected trader.',
      closed: 'This request has ended. Open a new shortage to try again.',
      wrong_pickup_code: 'Use the pickup code shown on the buyer’s phone.',
      pickup_locked: 'Too many wrong codes. The buyer can confirm with DONE.',
      already_held: 'This request is already held. Confirm pickup with DONE.',
      'pickup area is too long': 'Shorten the pickup area to 64 characters.',
      'choose a pickup': 'Check the seller inbox for the pickup to confirm.',
      'unparseable command': 'Check the reply and try again. Text HELP for available commands.',
    };
    if (error.status === 400) return messages[error.message] ?? 'Check the latest inbox reply, then try again.';
    return 'The wire is unavailable. Check your connection and try again.';
  }

  function renderLog(id, messages, empty) {
    const log = byId(id);
    const nodes = messages.map(message => {
      const card = document.createElement('div');
      card.className = 'msg ' + (message.sent ? 'msg-sent' : id === 'roomLog' ? 'msg-room' : 'msg-inbound');
      const from = document.createElement('div');
      from.className = 'msg-from';
      from.textContent = message.sent ? 'You sent' : message.sender ?? 'Market Wire';
      card.append(from, document.createTextNode(message.text));
      return card;
    });
    if (!nodes.length && empty) {
      const line = document.createElement('p');
      line.className = 'log-empty';
      line.textContent = empty;
      nodes.push(line);
    }
    log.replaceChildren(...nodes);
    log.scrollTop = log.scrollHeight;
  }

  function shortcut(button, value, label) {
    button.dataset.text = value;
    button.disabled = !value;
    if (label) button.textContent = label;
  }

  function choices(container, target, options) {
    container.replaceChildren(...options.map(([value, label]) => {
      const button = document.createElement('button');
      button.className = 'shortcut';
      button.type = 'button';
      button.dataset.target = target;
      shortcut(button, value, label);
      return button;
    }));
  }

  function render() {
    if (!snapshot) return;
    const seller = byId('senderSelect').value;
    byId('desktopInput').placeholder = 'E7 ' + sellerQuotes[seller] + '…';
    const { messages, requests, offers, currentTime } = snapshot;
    const time = clock.format(new Date(currentTime));
    for (const id of ['clockDisplay', 'mobileClock', 'desktopClock', 'roomClock']) byId(id).textContent = time;
    byId('footerMarket').textContent = session.marketId;

    const own = requests.filter(request => request.requester === 'mara');
    const current = own.at(-1);
    const active = request => ['open_local', 'widened'].includes(request.state);
    const available = offers.filter(offer => own.some(request => request.code === offer.requestCode && active(request)));
    byId('footerState').textContent = current
      ? current.code + ' ' + (current.state === 'open_local' ? 'open' : current.state)
      : 'No request yet';
    byId('footerOffers').textContent = available.length;

    const newMessages = JSON.stringify([seller, messages]);
    if (newMessages !== messageSignature) {
      messageSignature = newMessages;
      renderLog('mobileLog', messages.filter(message => message.to === 'mobile'), 'No texts yet.');
      renderLog('desktopLog', messages.filter(message =>
        message.to === 'desktop' && (message.recipient ?? message.from) === seller), 'No texts for this seller yet.');
      renderLog('roomLog', messages.filter(message => message.to === 'room'));
    }

    const newActions = JSON.stringify([seller, available, requests]);
    if (newActions === actionSignature) return;
    actionSignature = newActions;
    const holdActions = available.map(offer => [
      offer.ref + ' ' + offer.requestCode + (offer.revision > 1 ? ' V' + offer.revision : ''),
      'Hold ' + offer.sellerAlias + ' · ' + credits.format(offer.priceKobo / 100) + ' credits' +
        (available.some(other => other.requestCode !== offer.requestCode) ? ' · ' + offer.requestCode : ''),
    ]);
    const held = own.filter(request => request.state === 'held');
    const canWiden = own.filter(request => request.state === 'open_local').at(-1);
    const route = requests.find(request => request.state === 'widened' && !request.routed);
    const quoteActions = requests
      .filter(request => active(request) && request.invitedSellers.includes(seller))
      .map(request => [request.code + ' ' + sellerQuotes[seller], 'Quote ' + request.code]);
    shortcut(byId('acceptBtn'), holdActions[0]?.[0] ?? '', holdActions[0]?.[1] ?? 'Hold offer');
    shortcut(byId('doneBtn'), held[0] ? 'DONE ' + held[0].code : '',
      held.length > 1 ? 'Confirm ' + held[0].code + ' pickup' : 'Confirm pickup');
    shortcut(byId('widenBtn'), canWiden ? 'WIDEN ' + canWiden.code : '');
    choices(byId('extraOffers'), 'mobileInput',
      [...holdActions.slice(1), ...held.slice(1).map(request => ['DONE ' + request.code, 'Confirm ' + request.code + ' pickup'])]);
    choices(byId('sellerQuotes'), 'desktopInput', quoteActions);
    byId('routeBtn').disabled = !route;
    byId('routeBtn').dataset.code = route?.code ?? '';
    byId('routeFeedback').textContent = route ? '' : 'No request waiting to be routed';
  }

  async function refresh(active = session) {
    if (!active) return;
    const data = await request('/' + active.marketId + '/state', undefined, active);
    if (active !== session || (snapshot && data.messages.length < snapshot.messages.length)) return;
    snapshot = data;
    render();
  }

  function schedulePoll() {
    clearTimeout(poll);
    if (!session) return;
    poll = setTimeout(async () => {
      if (!busy) {
        try {
          await refresh();
        } catch (error) {
          if (error.status === 401 || error.status === 404) {
            remember(undefined);
            status('This session has ended. Choose Restart demo to start again.');
          } else {
            status(plainError(error));
          }
        }
      }
      schedulePoll();
    }, 1000);
  }

  async function openSession(restart = false) {
    if (busy) return;
    busy = true;
    status(restart ? 'Starting a fresh demo…' : 'Opening the wire…');
    try {
      if (restart && session) {
        remember(await request('/' + session.marketId + '/reset', {}));
        snapshot = undefined;
        byId('senderSelect').value = 'ellis';
        byId('mobileInput').value = '';
        byId('desktopInput').value = '';
        byId('mobileFeedback').textContent = '';
        byId('desktopFeedback').textContent = '';
      } else if (!session) {
        remember(await request('', { marketName: 'Demo Market' }));
      }
      await refresh();
      status();
    } catch (error) {
      if (error.status === 401 || error.status === 404) {
        remember(undefined);
        status('This session has ended. Choose Restart demo to start again.');
      } else {
        status(plainError(error));
      }
    } finally {
      busy = false;
      schedulePoll();
    }
  }

  async function mutate(path, payload, feedback, success) {
    if (busy || !session) return false;
    busy = true;
    feedback.textContent = '';
    try {
      await request('/' + session.marketId + path, payload);
    } catch (error) {
      feedback.textContent = plainError(error);
      try { await refresh(); } catch {}
      busy = false;
      return false;
    }
    try {
      await refresh();
      if (success) feedback.textContent = success;
    } catch (error) {
      status(plainError(error));
    } finally {
      busy = false;
    }
    return true;
  }

  function bindPhone(prefix, alias) {
    const input = byId(prefix + 'Input');
    const button = byId(prefix + 'SendBtn');
    const feedback = byId(prefix + 'Feedback');
    async function send() {
      const message = input.value.trim();
      if (!message || busy || !session) return;
      button.disabled = true;
      const ok = await mutate('/inbound', {
        alias: alias(), text: message, providerMessageId: crypto.randomUUID(),
      }, feedback);
      if (ok && input.value.trim() === message) input.value = '';
      button.disabled = false;
    }
    button.addEventListener('click', send);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        send();
      }
    });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('.shortcut');
    if (!button?.dataset.text) return;
    const input = byId(button.dataset.target);
    input.value = button.dataset.text;
    // Claude fix (22 Nov): a shortcut sends its text in one click; it used to only fill the box.
    const sendButton = byId(button.dataset.target.replace(/Input$/, 'SendBtn'));
    if (sendButton) sendButton.click();
    else input.focus();
  });
  const resetDialog = byId('resetDialog');
  byId('resetBtn').addEventListener('click', () => {
    if (!session) openSession();
    else {
      resetDialog.returnValue = '';
      resetDialog.showModal();
    }
  });
  resetDialog.addEventListener('close', () => {
    if (resetDialog.returnValue === 'restart') openSession(true);
  });
  byId('senderSelect').addEventListener('change', () => {
    byId('desktopInput').value = '';
    byId('desktopFeedback').textContent = '';
    render();
  });
  byId('routeBtn').addEventListener('click', () => mutate('/coordinator/route',
    { requestCode: byId('routeBtn').dataset.code }, byId('routeFeedback'), 'Sent to the neighboring circle'));
  byId('advanceTimeBtn').addEventListener('click', () => mutate('/clock', { minutes: 10 }, byId('statusBar')));
  bindPhone('mobile', () => 'mara');
  bindPhone('desktop', () => byId('senderSelect').value);
  remember(storedSession());
  openSession();
})();
