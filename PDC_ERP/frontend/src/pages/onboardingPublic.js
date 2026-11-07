// Public, login-free onboarding wizard for a new joiner. Reached via the personal link an admin sends:
//   <frontend>/#/onboard/<token>
import { $, esc, dateNow } from '../lib/dom.js';
import { isValidAadhaar, formatAadhaar } from '../lib/aadhaar.js';
import { fileToJpegDataUrl, videoFrameToJpeg } from '../lib/media.js';
import { compareFaces, loadFaceModels } from '../lib/face.js';

const STEPS = ['Your details', 'Aadhaar', 'Face check', 'NDA & sign'];

let token = '';
let info = null;
let step = 0;
let stream = null;
let sigStrokes = 0;

const D = {
  phone: '',
  dob: '',
  address: '',
  emergency_name: '',
  emergency_phone: '',
  aadhaar_number: '',
  front: '',
  back: '',
  consent: false,
  selfie: '',
  face: null, // { status, distance, match }
  nda_accepted: false,
  signed_name: '',
  signature: '',
};

async function pub(path, body) {
  const r = await fetch(`/api/onboarding/public/${encodeURIComponent(token)}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let d = {};
  try {
    d = await r.json();
  } catch (e) {
    /* empty body */
  }
  if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
  return d;
}

const shell = (inner) =>
  `<div class="ob-card"><img class="login-logo" src="/pdc-logo.png" alt="Pulse Digital Creation" />${inner}</div>`;

function screen(html) {
  $('onboard').innerHTML = shell(html);
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

export async function startOnboarding(tok) {
  token = tok;
  $('onboard').classList.remove('hidden');
  screen('<p class="mini" style="text-align:center">Loading your onboarding…</p>');
  try {
    info = await pub('');
  } catch (e) {
    screen(`<h2 class="ob-h">Link unavailable</h2><div class="err">${esc(e.message)}</div><p class="mini">If you think this is a mistake, please contact HR at Pulse Digital Creation.</p>`);
    return;
  }
  D.phone = info.prefill.phone || '';
  if (!info.can_submit) {
    screen(
      `<h2 class="ob-h">Already submitted</h2><div class="notice ok">Thanks, ${esc(info.full_name)} — your onboarding is with HR for review. You will be contacted with your login details once it is approved.</div>`
    );
    return;
  }
  step = 0;
  renderStep();
  // Warm the face models while they fill in the early steps, so the selfie step feels instant.
  setTimeout(() => loadFaceModels().catch(() => {}), 1500);
}

function stepper() {
  return `<ol class="ob-steps">${STEPS.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}"><span>${i < step ? '✓' : i + 1}</span>${esc(s)}</li>`).join('')}</ol>`;
}

function renderStep() {
  stopCamera();
  const body = [stepDetails, stepAadhaar, stepFace, stepNda][step]();
  screen(
    `<h2 class="ob-h">Welcome, ${esc(info.full_name.split(' ')[0])}</h2><p class="mini" style="margin:0 0 14px">Joining ${esc(info.company)}. This takes about 5 minutes. Your link expires on ${esc(
      info.expires_at.slice(0, 10)
    )}.</p>${stepper()}<div id="obErr" class="err hidden"></div>${body.html}`
  );
  body.bind();
  window.scrollTo({ top: 0 });
}

function showErr(msg) {
  const el = $('obErr');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
  if (msg) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function go(n) {
  step = n;
  renderStep();
}

// ---------------------------------------------------------------- step 1
function stepDetails() {
  return {
    html: `${info.note ? `<div class="notice warn"><b>HR asked for a correction:</b> ${esc(info.note)}</div>` : ''}
    <div class="fgrid">
      <div class="field"><label>Phone number *</label><input id="obPhone" inputmode="tel" value="${esc(D.phone)}" placeholder="+91 98765 43210"></div>
      <div class="field"><label>Date of birth *</label><input id="obDob" type="date" max="${dateNow()}" value="${esc(D.dob)}"></div>
      <div class="field full"><label>Current address *</label><textarea id="obAddr" placeholder="House / street / city / PIN">${esc(D.address)}</textarea></div>
      <div class="field"><label>Emergency contact name</label><input id="obEName" value="${esc(D.emergency_name)}"></div>
      <div class="field"><label>Emergency contact phone</label><input id="obEPhone" inputmode="tel" value="${esc(D.emergency_phone)}"></div>
    </div>
    <button class="btn ob-next" id="obNext">Continue</button>`,
    bind() {
      $('obNext').onclick = () => {
        D.phone = $('obPhone').value.trim();
        D.dob = $('obDob').value;
        D.address = $('obAddr').value.trim();
        D.emergency_name = $('obEName').value.trim();
        D.emergency_phone = $('obEPhone').value.trim();
        if (!D.phone) return showErr('Please enter your phone number.');
        if (!D.dob) return showErr('Please enter your date of birth.');
        if (!D.address) return showErr('Please enter your address.');
        go(1);
      };
    },
  };
}

// ---------------------------------------------------------------- step 2
function stepAadhaar() {
  return {
    html: `<div class="notice">🔒 We store <b>only the last 4 digits</b> of your Aadhaar number. The card images are visible only to authorised HR admins at ${esc(info.company)}.</div>
    <div class="field"><label>Aadhaar number *</label><input id="obAadhaar" inputmode="numeric" autocomplete="off" placeholder="XXXX XXXX XXXX" value="${esc(formatAadhaar(D.aadhaar_number))}"></div>
    <div class="fgrid">
      <div class="field"><label>Aadhaar card — front *</label><input id="obFront" type="file" accept="image/*"><div class="ob-prev" id="obFrontPrev">${D.front ? `<img src="${D.front}" alt="Aadhaar front">` : ''}</div></div>
      <div class="field"><label>Aadhaar card — back (optional)</label><input id="obBack" type="file" accept="image/*"><div class="ob-prev" id="obBackPrev">${D.back ? `<img src="${D.back}" alt="Aadhaar back">` : ''}</div></div>
    </div>
    <span class="mini">Use a clear, well-lit photo where the portrait and number are readable. Masked / e-Aadhaar printouts are fine.</span>
    <label class="ob-check"><input id="obConsent" type="checkbox" ${D.consent ? 'checked' : ''}> <span>I consent to ${esc(info.company)} collecting my Aadhaar card image and a selfie to verify my identity for employment. I understand access is limited to HR admins.</span></label>
    <div class="pnl" style="margin-top:12px"><button class="btn alt" id="obBack1">Back</button><button class="btn ob-next" id="obNext">Continue</button></div>`,
    bind() {
      $('obAadhaar').oninput = (e) => (e.target.value = formatAadhaar(e.target.value));
      const pick = (inputId, prevId, key) => {
        $(inputId).onchange = async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          showErr('');
          try {
            D[key] = await fileToJpegDataUrl(f);
            D.face = null; // the selfie must be re-checked against the new photo
            $(prevId).innerHTML = `<img src="${D[key]}" alt="">`;
          } catch (err) {
            showErr(err.message);
          }
        };
      };
      pick('obFront', 'obFrontPrev', 'front');
      pick('obBack', 'obBackPrev', 'back');
      $('obBack1').onclick = () => go(0);
      $('obNext').onclick = () => {
        D.aadhaar_number = $('obAadhaar').value.replace(/\s/g, '');
        D.consent = $('obConsent').checked;
        if (!isValidAadhaar(D.aadhaar_number)) return showErr('That Aadhaar number does not look right. Please re-check the 12 digits.');
        if (!D.front) return showErr('Please upload the front of your Aadhaar card.');
        if (!D.consent) return showErr('Please tick the consent box to continue.');
        go(2);
      };
    },
  };
}

// ---------------------------------------------------------------- step 3
const FACE_MESSAGES = {
  no_selfie_face: ['err', 'We could not see a face in that photo. Retake it facing the camera in good light.'],
  multiple_selfie_faces: ['err', 'More than one face was found. Retake with only you in the frame.'],
  no_id_face: ['warn', 'Selfie saved. We could not find the portrait on your Aadhaar image, so HR will verify it by eye.'],
};

function faceResultHtml() {
  const f = D.face;
  if (!f) return '';
  if (f.status === 'ok') {
    return f.match
      ? '<div class="notice ok">✅ Your selfie matches the photo on your ID.</div>'
      : '<div class="notice warn">Your selfie and ID photo did not match closely. This can happen with older ID photos or poor light — you can retake, or continue and HR will check it manually.</div>';
  }
  const [kind, msg] = FACE_MESSAGES[f.status];
  return `<div class="${kind === 'err' ? 'err' : 'notice warn'}">${esc(msg)}</div>`;
}

function canContinueFace() {
  return !!D.selfie && D.face && !['no_selfie_face', 'multiple_selfie_faces'].includes(D.face.status);
}

function stepFace() {
  const hasCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  return {
    html: `<div class="notice">Take a live selfie. Face the camera, in good light, with no cap or sunglasses.</div>
    <div class="ob-cam" id="obCam">
      ${D.selfie ? `<img id="obSelfieImg" src="${D.selfie}" alt="Your selfie">` : '<video id="obVideo" autoplay playsinline muted class="hidden"></video><div id="obCamEmpty" class="ob-cam-empty">Camera is off</div>'}
    </div>
    <div class="pnl" id="obCamBtns" style="margin:10px 0">
      ${hasCam ? '<button class="btn" id="obStart">' + (D.selfie ? 'Retake selfie' : 'Start camera') + '</button><button class="btn success hidden" id="obSnap">Capture</button>' : ''}
      <label class="btn alt ob-filebtn">${hasCam ? 'Upload instead' : 'Take / choose a selfie'}<input id="obSelfieFile" type="file" accept="image/*" capture="user" class="hidden"></label>
    </div>
    <div id="obFaceRes">${faceResultHtml()}</div>
    ${hasCam ? '' : '<span class="mini">Live camera is only available on https:// or localhost. Use the button above to take a photo with your phone camera.</span>'}
    <div class="pnl" style="margin-top:12px"><button class="btn alt" id="obBack2">Back</button><button class="btn ob-next" id="obNext">Continue</button></div>`,
    bind() {
      $('obBack2').onclick = () => go(1);
      const setBusy = (msg) => ($('obFaceRes').innerHTML = `<div class="notice">${esc(msg)}</div>`);

      const check = async () => {
        setBusy('Checking your photo… (the first check downloads the face model, ~12 MB)');
        try {
          D.face = await compareFaces(D.front, D.selfie);
        } catch (e) {
          // Models failed to load (offline, blocked...). Do not block onboarding — HR reviews by eye.
          D.face = { status: 'no_id_face', unavailable: true };
        }
        $('obFaceRes').innerHTML = faceResultHtml();
      };

      const setSelfie = async (dataUrl) => {
        stopCamera();
        D.selfie = dataUrl;
        D.face = null;
        $('obCam').innerHTML = `<img id="obSelfieImg" src="${dataUrl}" alt="Your selfie">`;
        $('obCamBtns').querySelector('#obStart')?.classList.remove('hidden');
        if ($('obStart')) $('obStart').textContent = 'Retake selfie';
        $('obSnap')?.classList.add('hidden');
        await check();
      };

      if ($('obStart')) {
        $('obStart').onclick = async () => {
          showErr('');
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
          } catch (e) {
            return showErr('Could not open the camera. Allow camera access in your browser, or use "Upload instead".');
          }
          $('obCam').innerHTML = '<video id="obVideo" autoplay playsinline muted></video>';
          const v = $('obVideo');
          v.srcObject = stream;
          $('obStart').classList.add('hidden');
          $('obSnap').classList.remove('hidden');
        };
        $('obSnap').onclick = async () => {
          const v = $('obVideo');
          if (!v || !v.videoWidth) return showErr('Camera is still starting — try again in a second.');
          await setSelfie(videoFrameToJpeg(v));
        };
      }
      $('obSelfieFile').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        showErr('');
        try {
          await setSelfie(await fileToJpegDataUrl(f, 1280));
        } catch (err) {
          showErr(err.message);
        }
      };
      $('obNext').onclick = () => {
        if (!D.selfie) return showErr('Please take a selfie to continue.');
        if (!D.face) return showErr('Please wait for the photo check to finish.');
        if (!canContinueFace()) return showErr('Please retake your selfie so your face is clearly visible.');
        go(3);
      };
      // Returning to this step with a selfie but no result (e.g. the ID photo was changed): re-check.
      if (D.selfie && !D.face) check();
    },
  };
}

// ---------------------------------------------------------------- step 4
function stepNda() {
  sigStrokes = D.signature ? 99 : 0; // a signature kept from an earlier visit to this step counts as drawn
  return {
    html: `<h3 class="ob-sub">Non-Disclosure Agreement</h3>
    <div class="nda-box" id="ndaBox">${esc(info.nda_text)}</div>
    <span class="mini" id="ndaHint">Scroll to the end to enable the checkbox.</span>
    <label class="ob-check"><input id="obNda" type="checkbox" disabled ${D.nda_accepted ? 'checked' : ''}> <span>I have read and agree to this Non-Disclosure Agreement.</span></label>
    <div class="field"><label>Type your full name *</label><input id="obSigName" autocomplete="name" value="${esc(D.signed_name || info.full_name)}"></div>
    <div class="field"><label>Draw your signature *</label>
      <div class="sig-wrap"><canvas id="sigPad" class="sig-pad"></canvas></div>
      <button class="btn alt" id="sigClear" type="button" style="justify-self:start">Clear</button>
    </div>
    <span class="mini">Signing records your name, the time, your device and IP address as proof of acceptance.</span>
    <div class="pnl" style="margin-top:12px"><button class="btn alt" id="obBack3">Back</button><button class="btn success ob-next" id="obSubmit">Submit for review</button></div>`,
    bind() {
      $('obBack3').onclick = () => {
        D.nda_accepted = $('obNda').checked;
        D.signed_name = $('obSigName').value;
        go(2);
      };
      // NDA: force the scroll-to-end so "I have read" is not a blind click.
      const box = $('ndaBox');
      const chk = $('obNda');
      const unlock = () => {
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 6) {
          chk.disabled = false;
          $('ndaHint').textContent = '';
        }
      };
      box.onscroll = unlock;
      unlock();
      if (D.nda_accepted) chk.disabled = false;
      setupSignaturePad();
      $('obSubmit').onclick = submit;
    },
  };
}

function setupSignaturePad() {
  const c = $('sigPad');
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = Math.round(rect.width * dpr);
  c.height = Math.round(rect.height * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111827';
  if (D.signature) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = D.signature;
  }
  let drawing = false;
  const pos = (e) => {
    const r = c.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  c.addEventListener('pointerdown', (e) => {
    drawing = true;
    c.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    e.preventDefault();
  });
  c.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    sigStrokes++;
    e.preventDefault();
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    D.signature = c.toDataURL('image/png');
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  $('sigClear').onclick = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    D.signature = '';
    sigStrokes = 0;
  };
}

async function submit() {
  showErr('');
  D.nda_accepted = $('obNda').checked;
  D.signed_name = $('obSigName').value.trim();
  if (!D.nda_accepted) return showErr('Please read the NDA to the end and tick the agreement box.');
  if (D.signed_name.length < 2) return showErr('Please type your full name.');
  if (sigStrokes < 8 || !D.signature) return showErr('Please draw your signature in the box.');

  const btn = $('obSubmit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  try {
    await pub('/submit', {
      phone: D.phone,
      dob: D.dob,
      address: D.address,
      emergency_name: D.emergency_name,
      emergency_phone: D.emergency_phone,
      aadhaar_number: D.aadhaar_number,
      aadhaar_front: D.front,
      aadhaar_back: D.back || undefined,
      selfie: D.selfie,
      face_score: D.face && D.face.status === 'ok' ? D.face.distance : undefined,
      face_match: !!(D.face && D.face.status === 'ok' && D.face.match),
      consent: D.consent,
      nda_accepted: true,
      signed_name: D.signed_name,
      signature: D.signature,
    });
    // Do not keep identity images in memory once they are uploaded.
    D.front = D.back = D.selfie = D.signature = '';
    D.aadhaar_number = '';
    screen(
      `<h2 class="ob-h">All done — thank you!</h2><div class="notice ok">Your details, ID verification and signed NDA have been sent to HR. Once they approve, you will receive your employee login. You can close this page.</div>`
    );
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Submit for review';
    showErr(e.message);
  }
}
