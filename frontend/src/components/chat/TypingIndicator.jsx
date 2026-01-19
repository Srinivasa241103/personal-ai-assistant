function TypingIndicator() {
  return (
    <div className="self-start bg-slate-700/70 px-4 py-2 rounded-2xl flex gap-1 w-fit animate-fade-in">
      <span className="animate-bounce">.</span>
      <span className="animate-bounce delay-150">.</span>
      <span className="animate-bounce delay-300">.</span>
    </div>
  );
}

export default TypingIndicator;
