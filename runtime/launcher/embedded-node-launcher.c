#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#ifndef OMAPILOT_ROOT_LEVELS
#error "OMAPILOT_ROOT_LEVELS must be defined"
#endif

extern const unsigned char _binary_payload_cjs_start[];
extern const unsigned char _binary_payload_cjs_end[];

static int write_all(int fd, const unsigned char *data, size_t length) {
  while (length > 0) {
    ssize_t written = write(fd, data, length);
    if (written < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    data += (size_t)written;
    length -= (size_t)written;
  }
  return 0;
}

static int set_plugin_root(void) {
  if (getenv("OMAPILOT_PLUGIN_ROOT") != NULL) return 0;

  char executable[PATH_MAX];
  ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
  if (length < 0 || (size_t)length >= sizeof(executable) - 1) return -1;
  executable[length] = '\0';

  char *end = executable + length;
  for (int level = 0; level < OMAPILOT_ROOT_LEVELS; level++) {
    char *slash = end;
    while (slash > executable && slash[-1] != '/') slash--;
    if (slash <= executable) return -1;
    slash[-1] = '\0';
    end = slash - 1;
  }
  return setenv("OMAPILOT_PLUGIN_ROOT", executable, 1);
}

int main(int argc, char **argv) {
  const unsigned char *payload = _binary_payload_cjs_start;
  size_t payload_size = (size_t)(_binary_payload_cjs_end - _binary_payload_cjs_start);
  int payload_fd = memfd_create("omapilot-runtime", MFD_ALLOW_SEALING);
  if (payload_fd < 0 || write_all(payload_fd, payload, payload_size) != 0) {
    fprintf(stderr, "OmaPilot: could not prepare the embedded runtime: %s\n", strerror(errno));
    return 126;
  }
  if (lseek(payload_fd, 0, SEEK_SET) < 0) {
    fprintf(stderr, "OmaPilot: could not rewind the embedded runtime: %s\n", strerror(errno));
    return 126;
  }
  if (fcntl(payload_fd, F_ADD_SEALS, F_SEAL_SEAL | F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE) < 0) {
    fprintf(stderr, "OmaPilot: could not seal the embedded runtime: %s\n", strerror(errno));
    return 126;
  }
  if (set_plugin_root() != 0) {
    fprintf(stderr, "OmaPilot: could not resolve the plugin root\n");
    return 126;
  }

  char payload_path[64];
  if (snprintf(payload_path, sizeof(payload_path), "/proc/self/fd/%d", payload_fd) < 0) return 126;
  if (setenv("OMAPILOT_PAYLOAD_PATH", payload_path, 1) != 0) return 126;

  static const char evaluator[] =
    "const fs=require('node:fs'),M=require('node:module'),p=require('node:path');"
    "const f=process.argv[1],m=new M(f);m.filename=f;m.paths=M._nodeModulePaths(p.dirname(f));"
    "m._compile(fs.readFileSync(process.env.OMAPILOT_PAYLOAD_PATH,'utf8'),f);";
  const char *logical_name = argv[0] != NULL ? argv[0] : "omapilot-runtime";
  const char *node = getenv("OMAPILOT_NODE_PATH");
  if (node == NULL || node[0] == '\0') node = "node";
  char **node_argv = calloc((size_t)argc + 4, sizeof(char *));
  if (node_argv == NULL) return 126;
  node_argv[0] = (char *)node;
  node_argv[1] = "-e";
  node_argv[2] = (char *)evaluator;
  node_argv[3] = (char *)logical_name;
  for (int index = 1; index < argc; index++) node_argv[index + 3] = argv[index];
  node_argv[argc + 3] = NULL;

  execvp(node_argv[0], node_argv);
  fprintf(stderr, "OmaPilot: could not start Node.js: %s\n", strerror(errno));
  return errno == ENOENT ? 127 : 126;
}
