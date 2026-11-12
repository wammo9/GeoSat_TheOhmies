/*
 * syscalls.c - minimal newlib hooks.
 *
 * _write sends stdout/stderr to the debug UART. The rest are stubs so newlib
 * links cleanly (they replace the warning-spewing ones from nosys.specs).
 * _sbrk (heap for printf) still comes from nosys.specs using the linker's `end`.
 */
#include "debug_uart.h"
#include <errno.h>
#include <sys/stat.h>

int _write(int fd, const char *buf, int len);
int _read(int fd, char *buf, int len);
int _close(int fd);
int _fstat(int fd, struct stat *st);
int _isatty(int fd);
int _lseek(int fd, int off, int whence);
int _getpid(void);
int _kill(int pid, int sig);

int _write(int fd, const char *buf, int len)
{
  (void)fd;
  for (int i = 0; i < len; i++) {
    if (buf[i] == '\n') {
      debug_uart_putc('\r');   /* terminals want CRLF */
    }
    debug_uart_putc(buf[i]);
  }
  return len;
}

int _read(int fd, char *buf, int len)          { (void)fd; (void)buf; (void)len; return 0; }
int _close(int fd)                             { (void)fd; return -1; }
int _fstat(int fd, struct stat *st)            { (void)fd; st->st_mode = S_IFCHR; return 0; }
int _isatty(int fd)                            { (void)fd; return 1; }
int _lseek(int fd, int off, int whence)        { (void)fd; (void)off; (void)whence; return 0; }
int _getpid(void)                              { return 1; }
int _kill(int pid, int sig)                    { (void)pid; (void)sig; errno = EINVAL; return -1; }
