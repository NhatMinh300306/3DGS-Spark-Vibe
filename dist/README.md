# Splat Lab — scene catalogue and dynamic PLY playback

Viewer dùng Spark 2.3.1 và Three.js 0.180.0. Render trên GPU máy người xem.
Đây là ứng dụng dựa trên Spark, không phải sản phẩm chính thức của World Labs.

## Mở web là có scene

- Mặc định: **Redandblack**, res8, frame 001450–001479, tự phát và lặp.
- Đổi scene và res1/res2/res4/res8 ngay trên khung nhìn. Có phát/tạm dừng và tải lại scene.
- Các mẫu cũ vẫn có: Cozy Spaceship, Hobbiton, Coit Tower, Poland và Butterfly.
- Chia sẻ URL dạng `?scene=redandblack&res=res4` hoặc `?scene=hobbit`.
- Nếu Redandblack không tải được, lần mở trang sẽ báo thiếu dữ liệu và mở Butterfly.
  Chọn lại Redandblack sau khi sửa dữ liệu để thử lại.

**Source ZIP không chứa 120 PLY của bạn.** Muốn khách truy cập thấy Redandblack mà không
chọn file, bạn phải xuất bản các PLY cùng web hoặc trỏ cấu hình tới server lưu dữ liệu.
Chọn thư mục trên máy chỉ là chế độ thử riêng, không upload dữ liệu cho người khác.

## Cập nhật project Windows hiện có

1. Giải nén ZIP vào thư mục tạm.
2. Chép các file trong `dist` của bản mới vào `D:\3DGS-Spark-Vibe\dist`.
   Giữ nguyên `dist/data` hiện có. Bản mới có thêm `scenes.js`.
3. Chép `prepare_pages.py`, `start-local.cmd` và thư mục `tools` vào thư mục gốc project.
4. Trong CMD, chạy:

```cmd
cd /d D:\3DGS-Spark-Vibe
py serve.py --bind 127.0.0.1 --port 8765 --directory dist
```

Mở http://127.0.0.1:8765/ . Hoặc mở `start-local.cmd` bằng cách nhấp đúp.
Trên Ubuntu: `python3 serve.py --bind 127.0.0.1 --port 8765 --directory dist`.
Không mở `index.html` bằng file://. Cần Internet để lấy engine/CDN và các scene mẫu.
Không cần npm để chạy viewer.

## Cấu trúc dữ liệu giữ nguyên

| Resolution | File đầu | File cuối |
| --- | --- | --- |
| res1 | data/redandblack-pages/res1/001450.ply | data/redandblack-pages/res1/001479.ply |
| res2 | data/redandblack-pages/res2/001450.ply | data/redandblack-pages/res2/001479.ply |
| res4 | data/redandblack-pages/res4/001450.ply | data/redandblack-pages/res4/001479.ply |
| res8 | data/redandblack-pages/res8/001450.ply | data/redandblack-pages/res8/001479.ply |

Các đường dẫn ở trên tương đối với `dist/index.html` hoặc `docs/index.html`.
Không cần sửa tên file. `manifest.json` và `.viewer-dataset` cũ được giữ nguyên;
viewer dùng cấu hình rõ ràng trong `scenes.js`, không tự diễn giải schema manifest cũ.

## Đưa cả code và PLY lên GitHub Pages

Trong CMD, tại thư mục project:

```cmd
py prepare_pages.py
git add docs
git commit -m "Publish scene catalogue and redandblack data"
git push
```

Script kiểm tra đủ 120 file, tạo lại `dist/source.zip`, chép **cả `dist/data`** sang
`docs/data` và tạo `.nojekyll`. Nếu thiếu PLY, script báo đường dẫn thiếu rồi dừng;
không biến lỗi thiếu dữ liệu thành một lần xuất bản có vẻ thành công.
Script không xóa dữ liệu cũ và không tự push Git. Dữ liệu không nằm trong source.zip.

Giữ **Settings → Pages → Deploy from a branch → main → /docs**.
Sau khi Actions thành công, mở URL Pages và nhấn Ctrl+F5. Bản trên Pages lấy dữ liệu
của Pages, không thể lấy file ở ổ D: của máy bạn. Hãy thử ở cửa sổ ẩn danh để kiểm tra
trải nghiệm của khách truy cập.

Lưu ý kích thước: kiểm tra giới hạn dung lượng hiện hành của dịch vụ trước khi đưa
cả dataset lớn lên repository/Pages. Nếu vượt giới hạn, giữ code trên Pages và đặt
`baseUrl` trong scenes.js thành URL thư mục trên storage HTTP khác có CORS. Git LFS
không phải cách tự động biến các file pointer thành dữ liệu phục vụ cho viewer.

Nếu chỉ thay code và dữ liệu trong docs đã có đủ:

```cmd
py prepare_pages.py --frontend-only
git add docs
git commit -m "Update viewer"
git push
```

## Thêm scene / đổi mặc định

Chỉnh `dist/scenes.js`. Các cấu hình chính:

```js
export const viewerSettings = {
  defaultSceneId: 'redandblack',
  fallbackSceneId: 'butterfly',
};
```

Mỗi sequence có `baseUrl`, `resolutions`, `firstFrame`, `lastFrame`, `padding`,
`defaultResolution`, `fps`, `rotationX`, cùng `autoplay` ở cấp scene.
Dùng URL tương đối `./data/.../` để chạy được cả localhost lẫn `/TEN_REPOSITORY/`.
Muốn lấy dữ liệu từ storage khác, đặt `baseUrl` thành URL HTTPS đầy đủ. Với scene tĩnh,
khai báo `type: 'static'`, `url`, các transform và camera tương tự mẫu hiện có.

Rotation X mặc định bằng 0 vì PLY nhập từ pipeline trước có thể đã xoay. Nếu nhân vật
nằm ngang, thử -90 độ rồi bấm Vừa khung; đặt lại `rotationX` trong scenes.js để mọi
người xem cùng một hướng mặc định. Camera được giữ nguyên khi đổi frame/resolution.

## Chức năng giữ lại

- Mở PLY/SPZ và các định dạng Spark hỗ trợ từ máy hoặc URL, thêm nhiều đối tượng tĩnh.
- RAD với `paged:true`, LoD/foveation, shared GPU page pool của Spark.
- Điều khiển opacity, màu, vị trí, xoay X, LoD từng đối tượng; ẩn/xóa đối tượng.
- SparkControls / OrbitControls, WASD/QE, zoom, tự xoay, home và fullscreen.
- FPS render, số splat/page và xuất CSV. Thêm FPS cập nhật nội dung và buffer.
- Dynamic nhập thư mục/multiple PLY, mở root URL, scrub, loop và giới hạn buffer.

Bộ chọn scene thay cảnh đang xem; chế độ “Mở thêm dữ liệu” vẫn cho phép thêm nhiều
đối tượng. Nút chọn nhiều file ở mục tĩnh thêm đối tượng cùng lúc; mục Dynamic dùng
các file đó như những frame liên tiếp.

## Giới hạn của playback

- Tải trước tuần tự, giữ 2–10 mesh frame sẵn sàng. Khi đổi scene/resolution, hủy fetch
  đang chờ; một decode đang chạy được dọn sau khi hoàn tất.
- Buffer giới hạn theo **số frame**, không phải số byte RAM/VRAM. Có thể có thêm một
  frame đang decode. Một frame lớn vẫn có thể tiêu tốn nhiều bộ nhớ.
- Chỉ một frame động hiển thị. Nếu frame kế chưa sẵn sàng thì giữ frame cũ và chờ;
  không nội suy, không bảo đảm 30 FPS và không tự bỏ frame để bám đồng hồ.
- Dynamic PLY dùng `lod:false`; LoD/foveation vẫn hoạt động cho các scene LoD tĩnh.
- FPS nội dung trong CSV đo lần đổi mesh ở ứng dụng, chưa phải số frame GPU đã present.
- Chưa có nén theo thời gian, decoder CAGS, ABR/DASH hoặc WebXR UI.
- Mẫu bên ngoài và engine/CDN phụ thuộc kết nối mạng/nhà cung cấp.

## Code dễ đọc

- `scenes.js`: catalogue, đường dẫn, camera và scene mặc định.
- `sequence.js`: nhóm PLY, tạo URL, buffer và timeline.
- `app.js`: khởi tạo renderer, scene selection và các điều khiển.
- `index.html`, `style.css`: giao diện và responsive layout.
- `prepare_pages.py`: chuẩn bị thư mục Pages kèm dữ liệu.

HTML/CSS/JS được format bằng Prettier với `.prettierrc.json`; không minify.
Trong VS Code có thể dùng Format Document với extension Prettier để giữ cách trình bày.

## Kiểm tra

Chạy test logic khi máy có Node.js:

```sh
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
```

Các test mock kiểm tra URL dưới thư mục repository, thứ tự frame, autoplay,
resolution, lỗi thiếu PLY, hủy tải, chỉ một frame hiển thị, buffer và cleanup.
Chưa có kiểm thử hình ảnh WebGL/GPU với 120 file thật của bạn trong môi trường tạo mã.
Các test không thay thế việc thử render bằng Chrome/Firefox trên máy thực.

## Nguồn scene và engine

- https://sparkjs.dev/
- https://sparkjs.dev/examples/streaming-lod/
- https://sparkjs.dev/docs/splat-mesh/
- Spaceship: Britt Casado / World Labs Marble; Hobbiton: Tijerin / World Labs Marble.
- Coit Tower: Vincent Woo; Poland: Andrii Shramko; Butterfly: Spark example asset.

Không đóng gói lại các dataset mẫu từ bên ngoài. Giấy phép dữ liệu và engine thuộc
chủ sở hữu tương ứng; mã giao diện riêng dùng LICENSE trong gói source.
