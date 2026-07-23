cmake_minimum_required(VERSION 3.22.1)

project(poio_mumble LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(POIO_NATIVE_ROOT "${CMAKE_CURRENT_LIST_DIR}/..")
set(LIBMUMBLE_ROOT "${POIO_NATIVE_ROOT}/libmumble")
set(GSL_ROOT "${POIO_NATIVE_ROOT}/third_party/gsl")

set(POIO_MUMBLE_SOURCES src/PoioMumbleBridge.cpp)

# The first dependency-complete build is arm64: it links the official
# libmumble core (TLS, OCB2, Opus, Protobuf and peer networking). Keep the
# smaller IP-only probe for the emulator/legacy ABIs until the same pinned
# dependency set has been cross-compiled for them as well.
if(ANDROID_ABI STREQUAL "arm64-v8a")
    add_library(mumble_library SHARED IMPORTED)
    set_target_properties(mumble_library PROPERTIES
        IMPORTED_LOCATION "${POIO_NATIVE_ROOT}/prebuilt/${ANDROID_ABI}/libmumble_library.so"
    )
    set(POIO_HAS_FULL_LIBMUMBLE 1)
else()
    list(APPEND POIO_MUMBLE_SOURCES "${LIBMUMBLE_ROOT}/src/IP.cpp")
    set(POIO_HAS_FULL_LIBMUMBLE 0)
endif()

add_library(poio_mumble SHARED ${POIO_MUMBLE_SOURCES})

target_include_directories(poio_mumble PRIVATE
    "${LIBMUMBLE_ROOT}/include"
    "${GSL_ROOT}/include"
)

target_compile_definitions(poio_mumble PRIVATE
    MUMBLE_SRC
    POIO_HAS_FULL_LIBMUMBLE=${POIO_HAS_FULL_LIBMUMBLE}
    POIO_LIBMUMBLE_COMMIT="4ce07284737cfc75ce2f1260ecd9ea3304055bd2"
)

target_compile_options(poio_mumble PRIVATE
    -Wall
    -Wextra
    -Wpedantic
    -Werror=return-type
)

find_library(log_library log REQUIRED)
find_library(aaudio_library aaudio REQUIRED)
target_link_libraries(poio_mumble PRIVATE "${log_library}" "${aaudio_library}")

if(POIO_HAS_FULL_LIBMUMBLE)
    target_link_libraries(poio_mumble PRIVATE mumble_library)
endif()
