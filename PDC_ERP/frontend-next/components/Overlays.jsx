'use client';
import { closeModal } from '../legacy/lib/dom.js';

// DOM hosts the shared helpers (openModal, toast) write into. React never manages their
// children - the helpers fill them directly - so the same helpers work for React pages
// and for the legacy modules.
export default function Overlays() {
  return (
    <>
      <div id="modal" className="modal" onClick={(e) => e.target.id === 'modal' && closeModal()}>
        <div className="modalCard">
          <div className="modalHead">
            <h3 id="modalTitle">Form</h3>
            <button className="close" id="modalCloseBtn" onClick={closeModal}>&times;</button>
          </div>
          <div id="modalBody" />
        </div>
      </div>
      <div id="toast" className="toast" />
    </>
  );
}
