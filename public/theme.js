const themeToggle = document.getElementById('themeToggle');

function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-theme');

        if (themeToggle) {
            themeToggle.textContent = '☀️';
        }
    } else {
        document.body.classList.remove('light-theme');

        if (themeToggle) {
            themeToggle.textContent = '🌙';
        }
    }
}

const savedTheme = localStorage.getItem('theme') || 'dark';
applyTheme(savedTheme);

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        const isLight = document.body.classList.contains('light-theme');

        const newTheme = isLight ? 'dark' : 'light';

        localStorage.setItem('theme', newTheme);

        applyTheme(newTheme);
    });
}