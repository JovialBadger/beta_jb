//toggle navigation menu
document.querySelectorAll('.btnNavToggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.body.classList.toggle('navOpen');
    });
});