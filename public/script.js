/* =====================================================
   Hey there! This is the main script file for Files on Cloud.
   It's written in plain vanilla JavaScript to keep things 
   super fast and lightweight. It handles everything from 
   uploading files to managing your session.
   ===================================================== */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const toastEl = $("toast");
  const API_BASE = "";
  let authToken = localStorage.getItem('authToken');
  let currentUser = null;
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
      setTimeout(() => (toastEl.hidden = true), 200);
    }, 1800);
  }

  /* ---------- Let's keep the copyright year up to date dynamically ---------- */
  $("year").textContent = new Date().getFullYear();

  /* ---------- Tab Switching Logic (Upload vs Download) ---------- */
  const tabs = document.querySelectorAll(".tab");
  const panels = {
    upload: $("panel-upload"),
    download: $("panel-download"),
  };
  function selectTab(name) {
    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
    Object.entries(panels).forEach(([k, el]) => (el.hidden = k !== name));
  }
  tabs.forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));
  document.querySelectorAll("[data-tab]").forEach((el) => {
    if (el.classList.contains("tab")) return;
    el.addEventListener("click", () => selectTab(el.dataset.tab));
  });

  /* ---------- A few handy helper functions ---------- */
  function formatSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / 1024 / 1024).toFixed(2) + " MB";
  }
  function genCode() {
    return String(Math.floor(10000 + Math.random() * 90000));
  }

  /* ---------- Everything related to uploading files securely ---------- */
  const dropzone = $("dropzone");
  const fileInput = $("fileInput");
  const dzTitle = $("dzTitle");
  const dzSub = $("dzSub");
  const codeInput = $("codeInput");
  const passwordInput = $("passwordInput");
  const expirySelect = $("expirySelect");
  const uploadBtn = $("uploadBtn");
  const progressWrap = $("progressWrap");
  const progressBar = $("progressBar");
  const progressText = $("progressText");

  const uploadForm = $("uploadForm");
  const uploadResult = $("uploadResult");
  const resultMeta = $("resultMeta");
  const codeDigits = $("codeDigits");
  const linkText = $("linkText");
  const qrToggle = $("qrToggle");
  const qrBox = $("qrBox");
  const qrImg = $("qrImg");

  let pickedFile = null;

  function setFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast("File exceeds 20MB limit");
      return;
    }
    pickedFile = file;
    dzTitle.textContent = file.name;
    dzSub.textContent = formatSize(file.size);

    const filePreview = $("filePreview");
    const previewContent = $("previewContent");

    if (!filePreview || !previewContent) return;

    if (file.type.startsWith("image/")) {
      //image preview
      const reader = new FileReader();

      reader.onload = (e) => {
        previewContent.innerHTML = `
          <img src="${e.target.result}" alt="Preview">
          <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-size">${formatSize(file.size)}</div>
          </div>
        `;
      };

      reader.readAsDataURL(file);
    }else if(file.type === "application/pdf"){
      //pdf preview
      const url = URL.createObjectURL(file);

      previewContent.innerHTML = `
        <iframe
          src="${url}"
          width="100%"
          height="400"
          style="border:none;border-radius:8px;">
        </iframe>
      `;
    } else if (
      file.type.startsWith("text/") ||
      file.name.endsWith(".json") ||
      file.name.endsWith(".md") ||
      file.name.endsWith(".js") ||
      file.name.endsWith(".css") ||
      file.name.endsWith(".html")
    ) {
      // text preview
      const reader = new FileReader();

      reader.onload = (e) => {
        const lines = e.target.result
          .split('\n')
          .slice(0, 10)
          .join('\n');

        previewContent.innerHTML = `
          <div class="file-info">
            <div class="file-name">📄 ${file.name}</div>
            <div class="file-size">${formatSize(file.size)}</div>
            <pre class="text-preview" style="
              white-space: pre-wrap;
              word-break: break-word;
              overflow-wrap: break-word;
            ">
              ${lines}
            </pre>
            <p class="muted">Showing first 10 lines...</p>
          </div>
        `;
      };

      reader.readAsText(file);
    }else {
      previewContent.innerHTML = `
        <div class="file-info">
          <div class="file-name">📄 ${file.name}</div>
          <div class="file-size">${formatSize(file.size)}</div>
        </div>
      `;
    }

    filePreview.hidden = false;
  }

  fileInput.addEventListener("change", (e) => setFile(e.target.files[0]));
  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-drag");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-drag");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
  });
  
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 5);
  });

  uploadBtn.addEventListener("click", () => {
    if (!pickedFile) return toast("Select a file first");
    if (codeInput.value && !/^\d{5}$/.test(codeInput.value))
      return toast("Code must be 5 digits");

    uploadBtn.disabled = true;
    progressWrap.hidden = false;
    progressBar.style.width = "50%";
    progressText.textContent = "Uploading…";

    const fd = new FormData();
    fd.append("file", pickedFile);
    if (codeInput.value) fd.append("code", codeInput.value);
    if (passwordInput.value) fd.append("password", passwordInput.value);
    fd.append("expiration", expirySelect.value);

    const headers = {};
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        headers,
        body: fd
    })
    .then(async res => {
        const data = await res.json();
        if (res.ok) {
            progressBar.style.width = "100%";
            progressText.textContent = "Uploading… 100%";
            setTimeout(() => showResult(data), 200);
        } else {
            toast(data.error || "Upload failed");
            uploadBtn.disabled = false;
            progressWrap.hidden = true;
        }
    })
    .catch(err => {
        toast("Upload failed. Check server connection.");
        uploadBtn.disabled = false;
        progressWrap.hidden = true;
    });
  });

  function showResult(data) {
    const code = data.code || codeInput.value;
    const link = data.downloadUrl || `${location.origin}/d/${code}`;

    resultMeta.textContent = `${pickedFile.name} · ${formatSize(pickedFile.size)} · expires soon ${passwordInput.value ? " · password protected" : ""}`;
    codeDigits.innerHTML = String(code)
      .split("")
      .map((d) => `<span>${d}</span>`)
      .join("");
    linkText.textContent = link;
    qrImg.src = data.qrCode || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`;

    uploadForm.hidden = true;
    uploadResult.hidden = false;
    toast("Uploaded — share your code");
  }

  /* ---------- Updated Clipboard Copy Code with UI Feedback Loops ---------- */
  $("copyCodeBtn").addEventListener("click", () => {
    const codeBtn = $("copyCodeBtn");
    const code = codeDigits.textContent.trim();
    
    navigator.clipboard.writeText(code).then(() => {
      toast("Code copied");
      
      // Inline button feedback
      const originalText = codeBtn.textContent;
      codeBtn.textContent = "Copied! ✓";
      codeBtn.style.backgroundColor = "#28a745"; // Success green
      codeBtn.style.borderColor = "#28a745";
      codeBtn.style.color = "#ffffff";
      
      setTimeout(() => {
        codeBtn.textContent = originalText;
        codeBtn.style.backgroundColor = "";
        codeBtn.style.borderColor = "";
        codeBtn.style.color = "";
      }, 2000);
    });
  });

  $("copyLinkBtn").addEventListener("click", () => {
    const linkBtn = $("copyLinkBtn");
    
    navigator.clipboard.writeText(linkText.textContent).then(() => {
      toast("Link copied");
      
      // Inline button feedback
      const originalText = linkBtn.textContent;
      linkBtn.textContent = "Link copied! ✓";
      linkBtn.style.backgroundColor = "#28a745"; // Success green
      linkBtn.style.borderColor = "#28a745";
      linkBtn.style.color = "#ffffff";
      
      setTimeout(() => {
        linkBtn.textContent = originalText;
        linkBtn.style.backgroundColor = "";
        linkBtn.style.borderColor = "";
        linkBtn.style.color = "";
      }, 2000);
    });
  });
  qrToggle.addEventListener("click", () => {
    qrBox.hidden = !qrBox.hidden;
    qrToggle.textContent = qrBox.hidden ? "Show QR" : "Hide QR";
  });
  $("resetBtn").addEventListener("click", () => {
    pickedFile = null;
    fileInput.value = "";
    codeInput.value = "";
    passwordInput.value = "";
    expirySelect.value = "24h";
    dzTitle.textContent = "Click to choose";
    dzSub.textContent = "or drag and drop · any file type";
    progressBar.style.width = "0%";
    progressText.textContent = "Uploading… 0%";
    progressWrap.hidden = true;
    uploadBtn.disabled = false;
    qrBox.hidden = true;
    qrToggle.textContent = "Show QR";
    uploadResult.hidden = true;
    uploadForm.hidden = false;
  });

  /* ---------- Handling file downloads and password checks ---------- */
  const dlCodeInput = $("dlCodeInput");
  const dlPwdField = $("dlPwdField");
  const dlPwdInput = $("dlPwdInput");
  const dlInfoBox = $("dlInfoBox");
  const dlFileName = $("dlFileName");
  const dlSize = $("dlSize");
  const dlCount = $("dlCount");
  const dlExpires = $("dlExpires");
  const dlLocked = $("dlLocked");

  dlCodeInput.addEventListener("input", () => {
    dlCodeInput.value = dlCodeInput.value.replace(/\D/g, "").slice(0, 5);
  });

  $("dlInfoBtn").addEventListener("click", async () => {
    const code = dlCodeInput.value;
    if (!/^\d{5}$/.test(code)) return toast("Enter a 5-digit code");
    
    try {
        const response = await fetch(`${API_BASE}/api/info/${code}`);
        const result = await response.json();
        
        if (response.ok) {
            dlFileName.textContent = result.originalName;
            dlSize.textContent = result.sizeFormatted;
            dlCount.textContent = String(result.downloadCount);
            dlExpires.textContent = new Date(result.expiresAt).toLocaleString();
            dlLocked.hidden = !result.hasPassword;
            dlPwdField.hidden = !result.hasPassword;
            dlInfoBox.hidden = false;
        } else {
            toast(result.error || "File not found");
        }
    } catch (error) {
        toast("Failed to get file info.");
    }
  });

  $("dlBtn").addEventListener("click", () => {
    const code = dlCodeInput.value;
    if (!/^\d{5}$/.test(code)) return toast("Enter a 5-digit code");
    if (!dlPwdField.hidden && !dlPwdInput.value) return toast("Password required");
    
    // redirect to the download endpoint, passing along the password if needed
    let url = `${API_BASE}/api/download/${code}`;
    if (!dlPwdField.hidden && dlPwdInput.value) {
        url += `?password=${encodeURIComponent(dlPwdInput.value)}`;
    }
    window.location.href = url;
  });

  /* ---------- User Authentication and Session Management ---------- */
  function goToAuthPage(mode) {
      window.location.href = `auth.html?mode=${mode}`;
  }

  function updateAuthUI() {
      const loginBtn = $("loginBtn");
      const signupBtn = $("signupBtn");
      const dashboardBtn = $("dashboardBtn");

        
      const mobileLoginBtn = $("mobileLoginBtn");
      const mobileSignupBtn = $("mobileSignupBtn");
      const mobileDashboardBtn = $("mobileDashboardBtn");

      if (!loginBtn) return;
      if(!mobileLoginBtn) return;

      if (currentUser) {
          loginBtn.textContent = `Hi, ${currentUser.username} (Logout)`;
          loginBtn.onclick = () => {
              localStorage.removeItem('authToken');
              authToken = null;
              currentUser = null;
              updateAuthUI();
              toast("Logged out successfully");
          };
          if (signupBtn) signupBtn.style.display = 'none';
          if (dashboardBtn) {
              dashboardBtn.style.display = 'inline-block';
              dashboardBtn.onclick = () => window.location.href = 'dashboard.html';
          }

        // Mobile
        if (mobileLoginBtn) {
            mobileLoginBtn.textContent = "Logout";

            mobileLoginBtn.onclick = () => {
                localStorage.removeItem("authToken");
                authToken = null;
                currentUser = null;
                updateAuthUI();
                toast("Logged out successfully");
            };
        }

        if (mobileSignupBtn) {
            mobileSignupBtn.style.display = "none";
        }

        if (mobileDashboardBtn) {
            mobileDashboardBtn.style.display = "inline-block";
            mobileDashboardBtn.onclick = () => {
                window.location.href = "dashboard.html";
            };
        }
      } else {
          loginBtn.textContent = 'Login';
          loginBtn.onclick = () => goToAuthPage('login');
          if (signupBtn) {
              signupBtn.style.display = 'inline-block';
              signupBtn.onclick = () => goToAuthPage('signup');
          }
          if (dashboardBtn) dashboardBtn.style.display = 'none';

          // Mobile
          if (mobileLoginBtn) {
              mobileLoginBtn.textContent = "Login";
              mobileLoginBtn.onclick = () => goToAuthPage("login");
          }

          if (mobileSignupBtn) {
              mobileSignupBtn.style.display = "inline-block";
              mobileSignupBtn.onclick = () => goToAuthPage("signup");
          }

          if (mobileDashboardBtn) {
              mobileDashboardBtn.style.display = "none";
          }
      }
  }

  async function checkAuthStatus() {
      if (!authToken) {
          updateAuthUI();
          return;
      }
      try {
          const response = await fetch(`${API_BASE}/api/auth/me`, {
              headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (response.ok) {
              const data = await response.json();
              currentUser = data.user;
          } else {
              localStorage.removeItem('authToken');
              authToken = null;
          }
      } catch (error) {
          localStorage.removeItem('authToken');
          authToken = null;
      }
      updateAuthUI();
  }

  checkAuthStatus();

  /* ---------- Managing the 'Upload Rules' popup modal ---------- */
  const uploadRulesBtn = $("uploadRulesBtn");
  const uploadRulesModal = $("uploadRulesModal");
  const uploadRulesClose = $("uploadRulesClose");
  
  if (uploadRulesBtn && uploadRulesModal && uploadRulesClose) {
      function openRules(e) {
          if (e) e.preventDefault();
          uploadRulesModal.hidden = false;
          uploadRulesModal.style.display = 'flex';
          setTimeout(() => {
              uploadRulesModal.style.opacity = '1';
              uploadRulesModal.children[0].style.transform = 'translateY(0)';
          }, 10);
      }
      function closeRules(e) {
          if (e) e.preventDefault();
          uploadRulesModal.style.opacity = '0';
          uploadRulesModal.children[0].style.transform = 'translateY(20px)';
          setTimeout(() => { 
              uploadRulesModal.hidden = true; 
              uploadRulesModal.style.display = ''; 
          }, 200);
      }
      uploadRulesBtn.addEventListener('click', openRules);
      uploadRulesClose.addEventListener('click', closeRules);
      uploadRulesModal.addEventListener('click', (e) => {
          if (e.target === uploadRulesModal) closeRules();
      });
  }


  const togglePassword = $('togglePassword');
  const eyeIcon = $('eyeIcon');

  // Toggle Logic inside the scope
  if (togglePassword) {
    togglePassword.addEventListener('click', function () {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      
      if (type === 'text') {
        eyeIcon.innerHTML = `
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        `;
      } else {
        eyeIcon.innerHTML = `
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        `;
      }
    });
  }

  const hamburgerBtn = document.getElementById("hamburgerBtn");
  const mobileMenu = document.getElementById("mobileMenu");
  const mobileOverlay = document.getElementById("mobileOverlay");
  const mobileLoginBtn = $("mobileLoginBtn");
const mobileSignupBtn = $("mobileSignupBtn");
const mobileDashboardBtn = $("mobileDashboardBtn");

  hamburgerBtn.addEventListener("click", () => {
    mobileMenu.classList.toggle("open");
    mobileOverlay.classList.toggle("show");
  });

  mobileOverlay.addEventListener("click", () => {
    mobileMenu.classList.remove("open");
    mobileOverlay.classList.remove("show");
  });

  document.querySelectorAll(".mobile-menu a").forEach(link => {
    link.addEventListener("click", () => {
      mobileMenu.classList.remove("open");
      mobileOverlay.classList.remove("show");
    });
  });
})();
