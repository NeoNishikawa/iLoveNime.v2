const form = document.querySelector("#feedbackForm");
const status = document.querySelector("#feedbackStatus");
const fields = { username: document.querySelector("#username"), description: document.querySelector("#description"), photo: document.querySelector("#photo") };
const errors = { username: document.querySelector("#usernameError"), description: document.querySelector("#descriptionError"), photo: document.querySelector("#photoError") };
const MAX_FILE_SIZE = Number(fields.photo.dataset.maxSize);
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);

function setError(name, message) {
  errors[name].textContent = message;
  fields[name].setAttribute("aria-invalid", message ? "true" : "false");
}
function validate() {
  Object.keys(errors).forEach((name) => setError(name, ""));
  status.textContent = "";
  let valid = true;
  if (!fields.username.value.trim()) { setError("username", "Nama pengguna wajib diisi."); valid = false; }
  if (!fields.description.value.trim()) { setError("description", "Penjelasan wajib diisi."); valid = false; }
  const file = fields.photo.files[0];
  if (file && !ALLOWED_TYPES.has(file.type)) { setError("photo", "File ditolak. Gunakan JPG atau PNG saja."); valid = false; }
  if (file && file.size > MAX_FILE_SIZE) { setError("photo", "File ditolak. Ukuran maksimal adalah 3 MB."); valid = false; }
  return valid;
}

fields.photo.addEventListener("change", validate);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validate()) { status.textContent = "Periksa kembali field yang ditandai sebelum melanjutkan."; return; }
  status.textContent = "Validasi berhasil. Saran: hubungkan tombol ini ke endpoint backend atau inbox admin sebelum menerima kiriman nyata.";
});
